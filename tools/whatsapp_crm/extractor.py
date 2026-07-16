#!/usr/bin/env python3
"""Create deterministic CRM import candidates from a Baileys history archive.

This module intentionally uses only the Python standard library, never makes a
network request, and never prints message or contact content.
"""

from __future__ import annotations

import argparse
import collections
import dataclasses
import datetime as dt
import hashlib
import json
import os
import re
import tempfile
import unicodedata
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping, MutableMapping, Sequence


SCHEMA_VERSION = 1
TOOL_NAME = "healen-whatsapp-crm-extractor"
TOOL_VERSION = "1.1.0"
RPC_MAX_CANDIDATES = 5_000
RPC_MAX_BYTES = 30 * 1024 * 1024

PERSON_DOMAINS = {"s.whatsapp.net", "c.us", "lid"}
NON_PERSON_DOMAINS = {"g.us", "broadcast", "newsletter"}

EMAIL_RE = re.compile(
    r"(?<![\w.+-])([A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,190}\.[A-Z]{2,24})(?![\w.-])",
    re.IGNORECASE,
)
DECLARED_NAME_RE = re.compile(
    r"\b(?:mi\s+nombre\s+es|me\s+llamo)\s+"
    r"([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’-]*(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’-]*){0,3})",
    re.IGNORECASE,
)
DECLARED_NAME_STOPWORDS = {
    "aunque", "con", "estoy", "hola", "me", "mi", "necesito", "para", "pero",
    "porque", "que", "quiero", "quisiera", "soy", "una", "un", "y",
}

INTEREST_PATTERNS: Mapping[str, tuple[str, ...]] = {
    "weight_management": (
        r"\bperdida de peso\b", r"\bbajar de peso\b", r"\bcontrol de peso\b",
        r"\bsemaglutida\b", r"\btirzepatida\b", r"\bozempic\b", r"\bmounjaro\b",
    ),
    "peptides": (r"\bpeptid(?:o|os|a|as)\b", r"\bpeptide(?:s)?\b"),
    "iv_therapy": (r"\bsueroterapia\b", r"\bsuero(?:s)?\b", r"\bterapia iv\b", r"\bvitaminas intravenosas\b"),
    "longevity": (r"\blongevidad\b", r"\bantiaging\b", r"\banti aging\b"),
    "hormone_therapy": (
        r"\bhormona(?:s|l)?\b", r"\btestosterona\b", r"\bmenopausia\b",
        r"\breemplazo hormonal\b",
    ),
    "aesthetic_medicine": (r"\bmedicina estetica\b", r"\bbotox\b", r"\bacido hialuronico\b"),
    "wellness_assessment": (r"\bchequeo\b", r"\bvaloracion\b", r"\bevaluacion\b", r"\bconsulta inicial\b"),
}

STAGE_PATTERNS: Sequence[tuple[str, int, tuple[str, ...]]] = (
    ("lost", 90, (
        r"\bno (?:me|nos) interesa\b", r"\bno estoy interesad[oa]\b",
        r"\bno quiero continuar\b", r"\bpor favor no me escriban\b",
    )),
    ("appointment_scheduled", 80, (
        r"\bcita confirmad[ao]\b", r"\bqued[oa] agendad[ao]\b",
        r"\bconfirmo (?:mi|la) cita\b", r"\bnos vemos el\b",
    )),
    ("appointment_pending", 70, (
        r"\bquiero (?:una )?cita\b", r"\bquisiera (?:una )?cita\b",
        r"\bagendar (?:una )?cita\b", r"\bdisponibilidad\b", r"\bque horarios?\b",
    )),
    ("qualified", 60, (
        r"\bcuanto (?:cuesta|vale)\b", r"\bprecio(?:s)?\b", r"\bvalor\b",
        r"\bcotizacion\b", r"\bforma(?:s)? de pago\b",
    )),
    ("follow_up", 50, (
        r"\bmas adelante\b", r"\bescribeme luego\b", r"\bcontactame luego\b",
        r"\bquedo pendiente\b",
    )),
    ("interested", 40, (
        r"\bme interesa\b", r"\bquiero (?:mas )?informacion\b",
        r"\bquisiera (?:mas )?informacion\b", r"\binformacion por favor\b",
    )),
)


def _sha256(value: str | bytes) -> str:
    data = value if isinstance(value, bytes) else value.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _fold_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    without_marks = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_marks.casefold()).strip()


def normalize_jid(value: Any) -> str | None:
    """Normalize device-qualified WhatsApp JIDs and the legacy c.us domain."""
    raw = str(value or "").strip().lower()
    if not raw or raw in {"self", "unknown", "none"}:
        return None
    if raw.startswith("+") and raw[1:].isdigit():
        return f"{raw[1:]}@s.whatsapp.net"
    if "@" not in raw:
        digits = re.sub(r"\D", "", raw)
        return f"{digits}@s.whatsapp.net" if 7 <= len(digits) <= 15 else None
    user, domain = raw.rsplit("@", 1)
    user = user.split(":", 1)[0].strip()
    if not user or not domain:
        return None
    if domain == "c.us":
        domain = "s.whatsapp.net"
    return f"{user}@{domain}"


def jid_domain(jid: str | None) -> str:
    return jid.rsplit("@", 1)[1] if jid and "@" in jid else ""


def is_person_jid(jid: str | None) -> bool:
    if not jid:
        return False
    domain = jid_domain(jid)
    if domain in NON_PERSON_DOMAINS:
        return False
    if domain in PERSON_DOMAINS:
        return True
    return bool(domain and domain not in {"status", "call"})


def e164_from_jid(jid: str | None) -> str | None:
    if not jid or jid_domain(jid) != "s.whatsapp.net":
        return None
    user = jid.split("@", 1)[0]
    return f"+{user}" if user.isdigit() and 7 <= len(user) <= 15 else None


def _normalize_rule_identity(value: Any) -> str | None:
    raw = str(value or "").strip()
    if raw.startswith("+") and raw[1:].isdigit():
        return raw
    jid = normalize_jid(raw)
    return jid or None


class DisjointSet:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, item: str | None) -> None:
        if item and is_person_jid(item):
            self.parent.setdefault(item, item)

    def find(self, item: str) -> str:
        self.add(item)
        parent = self.parent[item]
        if parent != item:
            self.parent[item] = self.find(parent)
        return self.parent[item]

    def union(self, *items: str | None) -> None:
        normalized = sorted({item for item in items if item and is_person_jid(item)})
        if not normalized:
            return
        roots = sorted({self.find(item) for item in normalized})
        root = roots[0]
        for other in roots[1:]:
            self.parent[other] = root

    def members(self) -> dict[str, set[str]]:
        result: dict[str, set[str]] = collections.defaultdict(set)
        for item in sorted(self.parent):
            result[self.find(item)].add(item)
        return dict(result)


@dataclasses.dataclass(frozen=True)
class ExtractionConfig:
    messages_path: Path
    catalog_path: Path
    output_dir: Path | None = None
    rules_path: Path | None = None
    rpc_payload_path: Path | None = None
    dry_run: bool = False
    strict: bool = False
    max_evidence_per_field: int = 3
    include_catalog_only: bool = True


@dataclasses.dataclass
class ParseStats:
    lines_read: int = 0
    valid_records: int = 0
    invalid_records: int = 0
    duplicates_skipped: int = 0


@dataclasses.dataclass
class ContactAggregate:
    root: str
    identities: set[str] = dataclasses.field(default_factory=set)
    sources: set[str] = dataclasses.field(default_factory=set)
    name_options: list[tuple[int, str, dict[str, Any]]] = dataclasses.field(default_factory=list)
    email_options: dict[str, list[dict[str, Any]]] = dataclasses.field(default_factory=lambda: collections.defaultdict(list))
    interest_evidence: dict[str, list[dict[str, Any]]] = dataclasses.field(default_factory=lambda: collections.defaultdict(list))
    stage_events: list[tuple[tuple[int, str, str, int], str, dict[str, Any]]] = dataclasses.field(default_factory=list)
    first_timestamp: int | None = None
    last_timestamp: int | None = None
    counts: collections.Counter[str] = dataclasses.field(default_factory=collections.Counter)
    direct_threads: set[str] = dataclasses.field(default_factory=set)
    group_threads: set[str] = dataclasses.field(default_factory=set)

    def touch_timestamp(self, timestamp: int | None) -> None:
        if timestamp is None:
            return
        self.first_timestamp = timestamp if self.first_timestamp is None else min(self.first_timestamp, timestamp)
        self.last_timestamp = timestamp if self.last_timestamp is None else max(self.last_timestamp, timestamp)


def _load_json_object(path: Path, *, label: str) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Unable to read a valid {label} JSON file") from exc
    if not isinstance(value, dict):
        raise ValueError(f"The {label} file must contain a JSON object")
    return value


def _read_rules(path: Path | None) -> dict[str, set[str]]:
    keys = ("staffIdentities", "vendorIdentities", "ignoredIdentities")
    raw = _load_json_object(path, label="rules") if path else {}
    unknown = set(raw) - set(keys)
    if unknown:
        raise ValueError("The rules file contains unsupported keys")
    result: dict[str, set[str]] = {}
    for key in keys:
        values = raw.get(key, [])
        if not isinstance(values, list):
            raise ValueError(f"Rule {key} must be a JSON array")
        normalized = {_normalize_rule_identity(value) for value in values}
        result[key] = {value for value in normalized if value}
    return result


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ValueError("Unable to read an input file") from exc
    return digest.hexdigest()


def _iter_jsonl(path: Path, stats: ParseStats, *, strict: bool) -> Iterator[dict[str, Any]]:
    try:
        handle = path.open("r", encoding="utf-8")
    except OSError as exc:
        raise ValueError("Unable to read the history JSONL file") from exc
    with handle:
        try:
            for line_number, line in enumerate(handle, start=1):
                stats.lines_read += 1
                if not line.strip():
                    continue
                try:
                    value = json.loads(line)
                    if not isinstance(value, dict):
                        raise ValueError("record is not an object")
                except (json.JSONDecodeError, ValueError) as exc:
                    stats.invalid_records += 1
                    if strict:
                        raise ValueError(f"Invalid history record at line {line_number}") from exc
                    continue
                stats.valid_records += 1
                yield value
        except UnicodeError as exc:
            raise ValueError("The history JSONL file is not valid UTF-8") from exc


def _identity_values(record: Mapping[str, Any], names: Iterable[str]) -> list[str]:
    result: list[str] = []
    for name in names:
        value = normalize_jid(record.get(name))
        if value and is_person_jid(value):
            result.append(value)
    return sorted(set(result))


def _catalog_identity_values(contact: Mapping[str, Any]) -> list[str]:
    return _identity_values(contact, ("id", "lid", "phoneNumber", "jid"))


def _timestamp_seconds(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        numeric = int(float(value))
    except (TypeError, ValueError, OverflowError):
        return None
    if numeric > 10_000_000_000:
        numeric //= 1000
    if numeric < 0 or numeric > 32_503_680_000:
        return None
    return numeric


def _iso_timestamp(value: int | None) -> str | None:
    if value is None:
        return None
    return dt.datetime.fromtimestamp(value, tz=dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _clean_name(value: Any) -> str | None:
    name = re.sub(r"\s+", " ", str(value or "")).strip(" \t\r\n,.;:-")
    if not 2 <= len(name) <= 80 or "@" in name or "http" in name.casefold():
        return None
    folded = _fold_text(name)
    if folded in {"unknown", "desconocido", "sin nombre", "you", "tu", "yo", "null"}:
        return None
    if sum(char.isdigit() for char in name) >= max(4, len(name) // 2):
        return None
    if not any(char.isalpha() for char in name):
        return None
    return name


def _clean_declared_name(value: Any) -> str | None:
    raw_tokens = re.sub(r"\s+", " ", str(value or "")).strip().split(" ")
    accepted: list[str] = []
    for token in raw_tokens:
        if accepted and _fold_text(token) in DECLARED_NAME_STOPWORDS:
            break
        accepted.append(token)
    return _clean_name(" ".join(accepted))


def _valid_email(value: str) -> bool:
    if len(value) > 254 or ".." in value:
        return False
    local, _, domain = value.rpartition("@")
    return bool(local and domain and not domain.startswith(".") and not domain.endswith("."))


def _message_evidence(record: Mapping[str, Any], body: str, field: str) -> dict[str, Any]:
    timestamp = _timestamp_seconds(record.get("timestamp"))
    content_hash = str(record.get("contentHash") or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", content_hash):
        content_hash = _sha256(body)
    message_id = str(record.get("messageId") or "").strip() or None
    return {
        "field": field,
        "messageId": message_id,
        "messageHash": content_hash,
        "timestamp": _iso_timestamp(timestamp),
        "direction": "outgoing" if bool(record.get("fromMe")) else "incoming",
    }


def _catalog_evidence(contact: Mapping[str, Any], field: str) -> dict[str, Any]:
    safe_shape = {
        "id": normalize_jid(contact.get("id")),
        "lid": normalize_jid(contact.get("lid")),
        "phoneNumber": normalize_jid(contact.get("phoneNumber")),
        "field": field,
    }
    return {"field": field, "source": "catalog", "sourceHash": _sha256(_canonical_json(safe_shape))}


def _dedupe_identity(record: Mapping[str, Any]) -> str:
    explicit = str(record.get("messageIdentity") or record.get("dedupeKey") or "").strip()
    if explicit:
        return explicit
    shape = {
        "chatId": normalize_jid(record.get("chatId")),
        "senderId": normalize_jid(record.get("senderId")),
        "fromMe": bool(record.get("fromMe")),
        "messageId": str(record.get("messageId") or ""),
        "timestamp": _timestamp_seconds(record.get("timestamp")),
        "contentHash": str(record.get("contentHash") or _sha256(str(record.get("body") or ""))),
    }
    return _sha256(_canonical_json(shape))


def _ensure_private_parent(path: Path) -> None:
    if not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    parent_mode = path.parent.stat().st_mode & 0o777
    if parent_mode & 0o077:
        raise ValueError("Private output directory must not be accessible by group or other users")


def _private_atomic_json(path: Path, value: Any) -> None:
    _ensure_private_parent(path)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
        os.chmod(path, 0o600)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def _rule_matches(identities: set[str], rules: set[str]) -> bool:
    comparable = set(identities)
    comparable.update(value for value in (e164_from_jid(jid) for jid in identities) if value)
    return bool(comparable & rules)


def _limited_evidence(values: Iterable[dict[str, Any]], maximum: int) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for value in values:
        key = _canonical_json(value)
        unique[key] = value
    ordered = sorted(
        unique.values(),
        key=lambda item: (
            str(item.get("timestamp") or ""),
            str(item.get("messageId") or ""),
            str(item.get("messageHash") or item.get("sourceHash") or ""),
        ),
    )
    return ordered[-maximum:]


def _identity_records(identities: set[str]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for jid in sorted(identities, key=lambda item: (0 if e164_from_jid(item) else 1, item)):
        domain = jid_domain(jid)
        identity_type = "whatsapp_pn" if domain == "s.whatsapp.net" else "whatsapp_lid" if domain == "lid" else "whatsapp_jid"
        item: dict[str, Any] = {
            "type": identity_type,
            "value": jid,
            "valueHash": _sha256(jid),
        }
        e164 = e164_from_jid(jid)
        if e164:
            item["e164"] = e164
            item["e164Hash"] = _sha256(e164)
        result.append(item)
    return result


def _candidate_from_aggregate(
    aggregate: ContactAggregate,
    *,
    rules: Mapping[str, set[str]],
    maximum_evidence: int,
) -> dict[str, Any] | None:
    identities = aggregate.identities
    if not identities or _rule_matches(identities, rules["ignoredIdentities"]):
        return None

    if _rule_matches(identities, rules["staffIdentities"]):
        contact_type, classification_reason = "staff", "exact_rule_match"
    elif _rule_matches(identities, rules["vendorIdentities"]):
        contact_type, classification_reason = "vendor", "exact_rule_match"
    elif aggregate.direct_threads:
        contact_type, classification_reason = "lead", "has_direct_conversation"
    elif aggregate.group_threads:
        contact_type, classification_reason = "group_only", "group_participant_without_direct_conversation"
    else:
        contact_type, classification_reason = "unknown", "catalog_or_reference_only"

    identity_records = _identity_records(identities)
    preferred = next((item.get("e164") for item in identity_records if item.get("e164")), None)
    if not preferred:
        preferred = next((item["value"] for item in identity_records if item["type"] == "whatsapp_lid"), identity_records[0]["value"])
    candidate_id = _sha256(f"{TOOL_NAME}:candidate:v1:{preferred}")

    proposed: dict[str, Any] = {}
    confidence: dict[str, float] = {}
    evidence: dict[str, list[dict[str, Any]]] = {}

    valid_names = [(priority, name, item) for priority, name, item in aggregate.name_options if _clean_name(name)]
    if valid_names:
        frequencies = collections.Counter(_fold_text(name) for _, name, _ in valid_names)
        priority, name, _ = sorted(
            valid_names,
            key=lambda item: (-item[0], -frequencies[_fold_text(item[1])], _fold_text(item[1]), item[1]),
        )[0]
        proposed["name"] = name
        confidence["name"] = min(0.99, round(priority / 100, 2))
        name_evidence = [item for _, option_name, item in valid_names if _fold_text(option_name) == _fold_text(name)]
        evidence["name"] = _limited_evidence(name_evidence, maximum_evidence)

    if aggregate.email_options:
        email = sorted(aggregate.email_options, key=lambda item: (-len(aggregate.email_options[item]), item))[0]
        proposed["email"] = email
        confidence["email"] = 0.97
        evidence["email"] = _limited_evidence(aggregate.email_options[email], maximum_evidence)

    interests = sorted(aggregate.interest_evidence)
    if interests:
        proposed["interests"] = interests
        confidence["interests"] = 0.75
        all_interest_evidence: list[dict[str, Any]] = []
        for interest in interests:
            all_interest_evidence.extend(aggregate.interest_evidence[interest])
        evidence["interests"] = _limited_evidence(all_interest_evidence, maximum_evidence)

    if aggregate.stage_events:
        _, stage, stage_evidence = sorted(aggregate.stage_events, key=lambda item: item[0])[-1]
        suggested_stage = stage
        evidence["suggestedStage"] = _limited_evidence([stage_evidence], maximum_evidence)
        stage_confidence = 0.78
    elif aggregate.counts["incoming"]:
        suggested_stage, stage_confidence = "new", 0.55
    elif aggregate.counts["outgoing"]:
        suggested_stage, stage_confidence = "contacted", 0.50
    else:
        suggested_stage, stage_confidence = "unclassified", 0.40
    proposed["suggestedStage"] = suggested_stage
    confidence["suggestedStage"] = stage_confidence

    e164_values = sorted({item["e164"] for item in identity_records if item.get("e164")})
    match_hints = {
        "e164": e164_values,
        "e164Hashes": [_sha256(value) for value in e164_values],
        # An email mentioned in a chat may belong to a third party. Keep the
        # selected email as a proposed field for human review, never as an
        # automatic identity in schema v1.
        "emails": [],
        "emailHashes": [],
        "automaticMatchAllowed": bool(e164_values),
        "nameOnlyMatchAllowed": False,
    }

    return {
        "candidateId": candidate_id,
        "importKey": f"whatsapp:{candidate_id}",
        "contactType": contact_type,
        "classification": {
            "reason": classification_reason,
            "patientStatus": "requires_database_treatment_match",
            "patientInferredFromMessages": False,
        },
        "identities": identity_records,
        "proposedFields": proposed,
        "fieldConfidence": confidence,
        "evidence": evidence,
        "activitySummary": {
            "firstMessageAt": _iso_timestamp(aggregate.first_timestamp),
            "lastMessageAt": _iso_timestamp(aggregate.last_timestamp),
            "messageCount": aggregate.counts["total"],
            "incomingCount": aggregate.counts["incoming"],
            "outgoingCount": aggregate.counts["outgoing"],
            "directMessageCount": aggregate.counts["direct"],
            "groupMessageCount": aggregate.counts["group"],
            "directThreadCount": len(aggregate.direct_threads),
            "groupThreadCount": len(aggregate.group_threads),
        },
        "matchHints": match_hints,
        "sourceKinds": sorted(aggregate.sources),
    }


def _rpc_candidate(candidate: Mapping[str, Any]) -> dict[str, Any]:
    source_contact_type = str(candidate["contactType"])
    canonical_contact_type = {
        "lead": "lead",
        "staff": "staff",
        "vendor": "supplier",
        "group_only": "group_only",
        "unknown": "unknown",
    }.get(source_contact_type, "other")
    confidence = {
        "staff": 1.0,
        "vendor": 1.0,
        "lead": 0.98,
        "group_only": 0.90,
        "unknown": 0.60,
    }.get(source_contact_type, 0.50)
    flattened_evidence: list[dict[str, Any]] = []
    evidence_by_field = candidate.get("evidence") or {}
    if isinstance(evidence_by_field, dict):
        for field in sorted(evidence_by_field):
            values = evidence_by_field[field]
            if isinstance(values, list):
                for value in values:
                    if isinstance(value, dict):
                        flattened_evidence.append(dict(value))
    flattened_evidence.sort(key=_canonical_json)

    return {
        "sourceRecordKey": candidate["importKey"],
        "candidateType": "contact_upsert",
        "confidence": confidence,
        "reason": candidate["classification"]["reason"],
        "proposedData": {
            "contactType": canonical_contact_type,
            "sourceContactType": source_contact_type,
            "identities": candidate["identities"],
            "fields": candidate["proposedFields"],
            "fieldConfidence": candidate["fieldConfidence"],
            "activitySummary": candidate["activitySummary"],
            "matchHints": candidate["matchHints"],
            "classification": candidate["classification"],
            "sourceKinds": candidate["sourceKinds"],
        },
        "evidence": flattened_evidence,
    }


def _build_aliases(
    messages_path: Path,
    catalog: Mapping[str, Any],
    *,
    strict: bool,
) -> tuple[DisjointSet, set[str], set[str], ParseStats]:
    dsu = DisjointSet()
    owners: set[str] = set()
    referenced: set[str] = set()

    for mapping in catalog.get("lidPnMappings", []) or []:
        if isinstance(mapping, dict):
            dsu.union(normalize_jid(mapping.get("pn") or mapping.get("phoneNumber")), normalize_jid(mapping.get("lid")))
    for contact in catalog.get("contacts", []) or []:
        if isinstance(contact, dict):
            identities = _catalog_identity_values(contact)
            dsu.union(*identities)
            referenced.update(identities)
    for chat in catalog.get("chats", []) or []:
        if isinstance(chat, dict):
            jid = normalize_jid(chat.get("id"))
            if is_person_jid(jid):
                dsu.add(jid)
                referenced.add(jid)

    stats = ParseStats()
    for record in _iter_jsonl(messages_path, stats, strict=strict):
        chat_aliases = _identity_values(record, ("chatId", "originalChatId", "alternateChatId"))
        sender_aliases = _identity_values(record, ("senderId", "alternateSenderId"))
        dsu.union(*chat_aliases)
        dsu.union(*sender_aliases)
        chat_id = normalize_jid(record.get("chatId"))
        is_group = bool(record.get("isGroup")) or jid_domain(chat_id) == "g.us"
        if not is_group:
            dsu.union(*(chat_aliases + sender_aliases if not bool(record.get("fromMe")) else chat_aliases))
        if bool(record.get("fromMe")):
            owners.update(sender_aliases)
        referenced.update(chat_aliases)
        referenced.update(sender_aliases)
        for field in ("mentionedIds",):
            values = record.get(field) or []
            if isinstance(values, list):
                for value in values:
                    jid = normalize_jid(value)
                    if is_person_jid(jid):
                        dsu.add(jid)
                        referenced.add(jid)
        for field in ("quotedParticipant", "quotedRemoteJid"):
            jid = normalize_jid(record.get(field))
            if is_person_jid(jid):
                dsu.add(jid)
                referenced.add(jid)

    owner_roots = {dsu.find(owner) for owner in owners if is_person_jid(owner)}
    return dsu, owner_roots, referenced, stats


def _get_aggregate(
    aggregates: MutableMapping[str, ContactAggregate],
    dsu: DisjointSet,
    root: str,
    member_map: Mapping[str, set[str]],
) -> ContactAggregate:
    aggregate = aggregates.get(root)
    if aggregate is None:
        aggregate = ContactAggregate(root=root, identities=set(member_map.get(root, {root})))
        aggregates[root] = aggregate
    return aggregate


def _add_catalog_data(
    aggregates: MutableMapping[str, ContactAggregate],
    dsu: DisjointSet,
    member_map: Mapping[str, set[str]],
    catalog: Mapping[str, Any],
) -> None:
    for contact in catalog.get("contacts", []) or []:
        if not isinstance(contact, dict):
            continue
        identities = _catalog_identity_values(contact)
        if not identities:
            continue
        root = dsu.find(identities[0])
        aggregate = _get_aggregate(aggregates, dsu, root, member_map)
        aggregate.sources.add("catalog_contact")
        for field, priority in (("verifiedName", 99), ("name", 96), ("notify", 90)):
            name = _clean_name(contact.get(field))
            if name:
                aggregate.name_options.append((priority, name, _catalog_evidence(contact, "name")))

    for chat in catalog.get("chats", []) or []:
        if not isinstance(chat, dict):
            continue
        jid = normalize_jid(chat.get("id"))
        if not is_person_jid(jid):
            continue
        root = dsu.find(jid)
        aggregate = _get_aggregate(aggregates, dsu, root, member_map)
        aggregate.sources.add("catalog_chat")
        for field, priority in (("name", 86), ("displayName", 84)):
            name = _clean_name(chat.get(field))
            if name:
                aggregate.name_options.append((priority, name, _catalog_evidence(chat, "name")))


def _process_messages(
    config: ExtractionConfig,
    dsu: DisjointSet,
    owner_roots: set[str],
    referenced: set[str],
    member_map: Mapping[str, set[str]],
    aggregates: MutableMapping[str, ContactAggregate],
) -> ParseStats:
    stats = ParseStats()
    seen: set[str] = set()
    for record in _iter_jsonl(config.messages_path, stats, strict=config.strict):
        dedupe = _dedupe_identity(record)
        if dedupe in seen:
            stats.duplicates_skipped += 1
            continue
        seen.add(dedupe)

        chat_id = normalize_jid(record.get("chatId"))
        is_group = bool(record.get("isGroup")) or jid_domain(chat_id) == "g.us"
        from_me = bool(record.get("fromMe"))
        chat_aliases = _identity_values(record, ("chatId", "originalChatId", "alternateChatId"))
        sender_aliases = _identity_values(record, ("senderId", "alternateSenderId"))

        if is_group:
            if from_me or not sender_aliases:
                continue
            root = dsu.find(sender_aliases[0])
        else:
            if not chat_aliases:
                continue
            root = dsu.find(chat_aliases[0])
        if root in owner_roots:
            continue

        aggregate = _get_aggregate(aggregates, dsu, root, member_map)
        aggregate.sources.add("history_message")
        timestamp = _timestamp_seconds(record.get("timestamp"))
        aggregate.touch_timestamp(timestamp)
        aggregate.counts["total"] += 1
        aggregate.counts["outgoing" if from_me else "incoming"] += 1
        aggregate.counts["group" if is_group else "direct"] += 1
        if is_group and chat_id:
            aggregate.group_threads.add(_sha256(chat_id))
        elif chat_id:
            aggregate.direct_threads.add(_sha256(chat_id))

        body = str(record.get("body") or "")
        sender_name = _clean_name(record.get("senderName"))
        chat_name = _clean_name(record.get("chatName"))
        if sender_name and not from_me:
            aggregate.name_options.append((82 if not is_group else 76, sender_name, _message_evidence(record, body, "name")))
        if chat_name and not is_group:
            aggregate.name_options.append((80, chat_name, _message_evidence(record, body, "name")))

        if not body:
            continue
        folded = _fold_text(body)
        evidence_factory = lambda field: _message_evidence(record, body, field)

        # Profile fields must be stated by the contact, never inferred from an
        # outbound staff message. Group messages are attributable to senderId.
        if not from_me:
            declared_match = DECLARED_NAME_RE.search(body)
            if declared_match:
                declared_name = _clean_declared_name(declared_match.group(1))
                if declared_name:
                    aggregate.name_options.append((98, declared_name, evidence_factory("name")))
            for match in EMAIL_RE.finditer(body):
                email = match.group(1).casefold().rstrip(".")
                if _valid_email(email):
                    aggregate.email_options[email].append(evidence_factory("email"))
            for interest, patterns in INTEREST_PATTERNS.items():
                if any(re.search(pattern, folded) for pattern in patterns):
                    aggregate.interest_evidence[interest].append(evidence_factory("interests"))

        # Pipeline evidence belongs to the direct conversation and may be in an
        # inbound request or an outbound appointment confirmation. Group text
        # is not treated as a sales pipeline update.
        if not is_group:
            message_stage_events: list[tuple[str, int]] = []
            for stage, rank, patterns in STAGE_PATTERNS:
                if any(re.search(pattern, folded) for pattern in patterns):
                    message_stage_events.append((stage, rank))
            if message_stage_events:
                stage, rank = sorted(message_stage_events, key=lambda item: (item[1], item[0]))[-1]
                timestamp_sort = timestamp if timestamp is not None else -1
                message_id = str(record.get("messageId") or "")
                aggregate.stage_events.append(((timestamp_sort, message_id, stage, rank), stage, evidence_factory("suggestedStage")))

    # Identities referenced in messages but without an attributable message are
    # retained as unknown placeholders, unless they resolve to the owner.
    for identity in sorted(referenced):
        root = dsu.find(identity)
        if root in owner_roots:
            continue
        aggregate = _get_aggregate(aggregates, dsu, root, member_map)
        aggregate.sources.add("history_reference")
    return stats


def extract_candidates(config: ExtractionConfig) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any] | None]:
    if not 1 <= config.max_evidence_per_field <= 10:
        raise ValueError("max_evidence_per_field must be between 1 and 10")
    if not config.messages_path.is_file() or not config.catalog_path.is_file():
        raise ValueError("Both history input files must exist")
    if not config.dry_run and config.output_dir is None:
        raise ValueError("output_dir is required unless dry_run is enabled")

    catalog = _load_json_object(config.catalog_path, label="catalog")
    for collection_name in ("contacts", "chats", "lidPnMappings"):
        value = catalog.get(collection_name, [])
        if value is not None and not isinstance(value, list):
            raise ValueError(f"Catalog field {collection_name} must be an array")
    rules = _read_rules(config.rules_path)

    input_digests = {
        "historyCatalogSha256": _file_digest(config.catalog_path),
        "historyMessagesSha256": _file_digest(config.messages_path),
        "rulesSha256": _sha256(_canonical_json({key: sorted(value) for key, value in rules.items()})),
    }
    extraction_options = {
        "includeCatalogOnly": config.include_catalog_only,
        "maxEvidencePerField": config.max_evidence_per_field,
        "strict": config.strict,
        "schemaVersion": SCHEMA_VERSION,
        "generator": {"name": TOOL_NAME, "version": TOOL_VERSION},
    }
    # Idempotency covers every deterministic input that can change candidates,
    # not just the two history files. Reusing a run key can therefore never
    # leave stale candidates from a different extraction configuration.
    source_fingerprint = _sha256(_canonical_json({
        "inputDigests": input_digests,
        "extractionOptions": extraction_options,
    }))
    run_id = _sha256(f"{TOOL_NAME}:{TOOL_VERSION}:{source_fingerprint}")

    dsu, owner_roots, referenced, alias_stats = _build_aliases(
        config.messages_path,
        catalog,
        strict=config.strict,
    )
    member_map = dsu.members()
    aggregates: dict[str, ContactAggregate] = {}
    _add_catalog_data(aggregates, dsu, member_map, catalog)
    message_stats = _process_messages(config, dsu, owner_roots, referenced, member_map, aggregates)

    final_input_digests = {
        "historyCatalogSha256": _file_digest(config.catalog_path),
        "historyMessagesSha256": _file_digest(config.messages_path),
    }
    if any(input_digests[key] != value for key, value in final_input_digests.items()):
        raise ValueError("History inputs changed during extraction; retry with an immutable snapshot")

    candidates: list[dict[str, Any]] = []
    for root in sorted(aggregates):
        if root in owner_roots:
            continue
        aggregate = aggregates[root]
        if not config.include_catalog_only and not aggregate.counts["total"]:
            continue
        candidate = _candidate_from_aggregate(
            aggregate,
            rules=rules,
            maximum_evidence=config.max_evidence_per_field,
        )
        if candidate:
            candidates.append(candidate)
    candidates.sort(key=lambda item: item["candidateId"])

    classification_counts = collections.Counter(item["contactType"] for item in candidates)
    stage_counts = collections.Counter(item["proposedFields"]["suggestedStage"] for item in candidates)
    interest_counts: collections.Counter[str] = collections.Counter()
    for item in candidates:
        interest_counts.update(item["proposedFields"].get("interests", []))

    all_first_dates = [item["activitySummary"]["firstMessageAt"] for item in candidates if item["activitySummary"]["firstMessageAt"]]
    all_last_dates = [item["activitySummary"]["lastMessageAt"] for item in candidates if item["activitySummary"]["lastMessageAt"]]

    candidates_document = {
        "schemaVersion": SCHEMA_VERSION,
        "generator": {"name": TOOL_NAME, "version": TOOL_VERSION},
        "run": {
            "runId": run_id,
            "sourceFingerprint": source_fingerprint,
            "inputDigests": input_digests,
            "datasetFirstMessageAt": min(all_first_dates) if all_first_dates else None,
            "datasetLastMessageAt": max(all_last_dates) if all_last_dates else None,
            "patientClassificationPolicy": "database_treatment_match_only",
        },
        "candidates": candidates,
    }

    summary = {
        "schemaVersion": SCHEMA_VERSION,
        "generator": {"name": TOOL_NAME, "version": TOOL_VERSION},
        "runId": run_id,
        "sourceFingerprint": source_fingerprint,
        "dryRun": config.dry_run,
        "containsPii": False,
        "totals": {
            "historyLinesRead": message_stats.lines_read,
            "validMessageRecords": message_stats.valid_records,
            "invalidMessageRecords": message_stats.invalid_records,
            "duplicateMessageRecordsSkipped": message_stats.duplicates_skipped,
            "candidateCount": len(candidates),
            "classificationCounts": dict(sorted(classification_counts.items())),
            "stageCounts": dict(sorted(stage_counts.items())),
            "interestCounts": dict(sorted(interest_counts.items())),
            "ownerIdentitySetsExcluded": len(owner_roots),
            "identityAliasSets": len(member_map),
        },
        "validation": {
            "aliasPassLinesRead": alias_stats.lines_read,
            "aliasPassInvalidRecords": alias_stats.invalid_records,
            "patientInferredFromMessages": False,
            "nameOnlyAutomaticMatching": False,
        },
    }

    rpc_document: dict[str, Any] | None = None
    if config.rpc_payload_path is not None:
        rpc_document = {
            "rpc": "crm_ingest_candidates",
            "params": {
                "p_payload": {
                    "schemaVersion": SCHEMA_VERSION,
                    "run": {
                        "id": run_id,
                        "source": "whatsapp_history_read_only",
                        "idempotencyKey": run_id,
                        "sourceChecksum": source_fingerprint,
                        "config": {
                            "generator": {"name": TOOL_NAME, "version": TOOL_VERSION},
                            "includeCatalogOnly": config.include_catalog_only,
                            "maxEvidencePerField": config.max_evidence_per_field,
                            "strict": config.strict,
                            "patientClassificationPolicy": "database_treatment_match_only",
                        },
                    },
                    "candidates": [_rpc_candidate(candidate) for candidate in candidates],
                },
            },
        }

        if len(candidates) > RPC_MAX_CANDIDATES:
            raise ValueError("RPC payload exceeds the database candidate limit; split the immutable snapshot explicitly")
        rpc_bytes = len((_canonical_json(rpc_document) + "\n").encode("utf-8"))
        if rpc_bytes > RPC_MAX_BYTES:
            raise ValueError("RPC payload exceeds the database size limit; reduce evidence or split the immutable snapshot")

    if not config.dry_run:
        assert config.output_dir is not None
        candidate_path = config.output_dir / "candidates.json"
        summary_path = config.output_dir / "summary.json"
        output_paths = [candidate_path, summary_path]
        if config.rpc_payload_path is not None:
            output_paths.append(config.rpc_payload_path)
        # Validate every destination before writing the first PII-bearing file,
        # preventing a partially emitted import when one path is not private.
        for output_path in output_paths:
            _ensure_private_parent(output_path)
        _private_atomic_json(candidate_path, candidates_document)
        _private_atomic_json(summary_path, summary)
        if config.rpc_payload_path is not None and rpc_document is not None:
            _private_atomic_json(config.rpc_payload_path, rpc_document)

    return candidates_document, summary, rpc_document


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract private, deterministic CRM candidates from WhatsApp history without network or DB writes.",
    )
    parser.add_argument("--messages", required=True, type=Path, help="Path to history_messages.jsonl")
    parser.add_argument("--catalog", required=True, type=Path, help="Path to history_catalog.json")
    parser.add_argument("--output-dir", type=Path, help="Private output directory (required unless --dry-run)")
    parser.add_argument("--rules", type=Path, help="Optional private exact-identity rules JSON")
    parser.add_argument("--rpc-payload", type=Path, help="Also write a private crm_ingest_candidates request body")
    parser.add_argument("--dry-run", action="store_true", help="Analyze fully, print only aggregate counts, and write nothing")
    parser.add_argument("--strict", action="store_true", help="Abort on the first malformed JSONL record")
    parser.add_argument("--max-evidence", type=int, default=3, help="Maximum evidence references per proposed field (1-10)")
    parser.add_argument("--exclude-catalog-only", action="store_true", help="Omit contacts that have no attributable message")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if not args.dry_run and args.output_dir is None:
        parser.error("--output-dir is required unless --dry-run is used")
    try:
        _, summary, _ = extract_candidates(ExtractionConfig(
            messages_path=args.messages,
            catalog_path=args.catalog,
            output_dir=args.output_dir,
            rules_path=args.rules,
            rpc_payload_path=args.rpc_payload,
            dry_run=args.dry_run,
            strict=args.strict,
            max_evidence_per_field=args.max_evidence,
            include_catalog_only=not args.exclude_catalog_only,
        ))
    except ValueError as exc:
        parser.exit(2, f"error: {exc}\n")
    except OSError:
        parser.exit(2, "error: private filesystem operation failed\n")

    totals = summary["totals"]
    # Deliberately aggregate-only: never print a path, identity, name, email, or
    # message excerpt, even when malformed input is encountered.
    print(_canonical_json({
        "candidateCount": totals["candidateCount"],
        "classificationCounts": totals["classificationCounts"],
        "duplicateMessageRecordsSkipped": totals["duplicateMessageRecordsSkipped"],
        "invalidMessageRecords": totals["invalidMessageRecords"],
        "validMessageRecords": totals["validMessageRecords"],
        "writesPerformed": not args.dry_run,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
