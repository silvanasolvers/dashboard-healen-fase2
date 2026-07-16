from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest import mock
from pathlib import Path

import extractor as extractor_module
from extractor import (
    ExtractionConfig,
    e164_from_jid,
    extract_candidates,
    is_person_jid,
    main,
    normalize_jid,
)


LEAD_PHONE = "+573001234567"
LEAD_EMAIL = "ana.private@example.com"
STAFF_PHONE = "+573009999991"
VENDOR_PHONE = "+573009999992"
UNKNOWN_PHONE = "+573009999993"
GROUP_PHONE = "+573009999994"
OWNER_PHONE = "+573009999990"


def message(
    identity: str,
    *,
    chat_id: str,
    sender_id: str,
    body: str,
    timestamp: int,
    from_me: bool = False,
    is_group: bool = False,
    alternate_chat_id: str | None = None,
    alternate_sender_id: str | None = None,
    sender_name: str | None = None,
) -> dict:
    return {
        "schemaVersion": 2,
        "messageIdentity": identity,
        "contentHash": "a" * 64 if identity == "lead-1" else "b" * 64,
        "messageId": f"msg-{identity}",
        "chatId": chat_id,
        "alternateChatId": alternate_chat_id,
        "senderId": sender_id,
        "alternateSenderId": alternate_sender_id,
        "senderName": sender_name,
        "fromMe": from_me,
        "direction": "outgoing" if from_me else "incoming",
        "timestamp": timestamp,
        "body": body,
        "isGroup": is_group,
    }


class ExtractorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.messages_path = self.root / "history_messages.jsonl"
        self.catalog_path = self.root / "history_catalog.json"
        self.rules_path = self.root / "rules.json"
        self.output_dir = self.root / "private-output"

        catalog = {
            "schemaVersion": 2,
            "lidPnMappings": [
                {"lid": "900@lid", "pn": "573001234567@s.whatsapp.net"},
                {"lid": "800@lid", "pn": "573009999994@s.whatsapp.net"},
            ],
            "contacts": [
                {
                    "id": "900@lid",
                    "lid": "900@lid",
                    "phoneNumber": "573001234567@s.whatsapp.net",
                    "name": "Ana Catalog",
                },
                {"id": "573009999991@s.whatsapp.net", "verifiedName": "Equipo Healen"},
                {"id": "573009999992@s.whatsapp.net", "name": "Proveedor Uno"},
                {"id": "573009999993@s.whatsapp.net", "name": "Contacto Sin Chat"},
                {"id": "573009999990@s.whatsapp.net", "name": "Cuenta Propia"},
            ],
            "chats": [
                {"id": "900@lid", "name": "Ana Chat"},
                {"id": "12345@g.us", "name": "Grupo Privado"},
            ],
        }
        self.catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
        self.rules_path.write_text(json.dumps({
            "staffIdentities": [STAFF_PHONE],
            "vendorIdentities": [VENDOR_PHONE],
            "ignoredIdentities": [],
        }), encoding="utf-8")

        records = [
            message(
                "lead-1",
                chat_id="900@lid",
                alternate_chat_id="573001234567:4@s.whatsapp.net",
                sender_id="900@lid",
                alternate_sender_id="573001234567@s.whatsapp.net",
                sender_name="Ana WhatsApp",
                body=f"Hola, me llamo Ana y quiero información de semaglutida. Mi correo es {LEAD_EMAIL}",
                timestamp=1_720_000_000,
            ),
            # Exact duplicate must not change counts or evidence.
            message(
                "lead-1",
                chat_id="900@lid",
                alternate_chat_id="573001234567@s.whatsapp.net",
                sender_id="900@lid",
                body=f"Hola, me llamo Ana y quiero información de semaglutida. Mi correo es {LEAD_EMAIL}",
                timestamp=1_720_000_000,
            ),
            message(
                "lead-2",
                chat_id="900@lid",
                sender_id="573009999990@s.whatsapp.net",
                body="Tu cita confirmada para mañana.",
                timestamp=1_720_000_100,
                from_me=True,
            ),
            message(
                "group-1",
                chat_id="12345@g.us",
                sender_id="800@lid",
                alternate_sender_id="573009999994@s.whatsapp.net",
                sender_name="Persona Grupo",
                body="Me interesan los péptidos.",
                timestamp=1_720_000_200,
                is_group=True,
            ),
            message(
                "staff-1",
                chat_id="573009999991@s.whatsapp.net",
                sender_id="573009999991@s.whatsapp.net",
                sender_name="Equipo Healen",
                body="Mensaje interno.",
                timestamp=1_720_000_300,
            ),
            # Detect and exclude the owner from both catalog and group activity.
            message(
                "owner-1",
                chat_id="12345@g.us",
                sender_id="573009999990@s.whatsapp.net",
                body="Mensaje propio en grupo.",
                timestamp=1_720_000_400,
                from_me=True,
                is_group=True,
            ),
        ]
        with self.messages_path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            handle.write("{malformed-json-with-private-content\n")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def config(self, **overrides) -> ExtractionConfig:
        values = {
            "messages_path": self.messages_path,
            "catalog_path": self.catalog_path,
            "output_dir": self.output_dir,
            "rules_path": self.rules_path,
            "rpc_payload_path": self.output_dir / "rpc-payload.json",
        }
        values.update(overrides)
        return ExtractionConfig(**values)

    def test_jid_normalization_and_person_detection(self) -> None:
        self.assertEqual(normalize_jid("573001234567:9@c.us"), "573001234567@s.whatsapp.net")
        self.assertEqual(normalize_jid(LEAD_PHONE), "573001234567@s.whatsapp.net")
        self.assertEqual(e164_from_jid(normalize_jid(LEAD_PHONE)), LEAD_PHONE)
        self.assertTrue(is_person_jid("900@lid"))
        self.assertFalse(is_person_jid("12345@g.us"))
        self.assertFalse(is_person_jid("status@broadcast"))

    def test_extracts_aliases_classifications_fields_and_evidence(self) -> None:
        document, summary, rpc = extract_candidates(self.config())
        candidates = document["candidates"]
        by_type = {}
        for candidate in candidates:
            by_type.setdefault(candidate["contactType"], []).append(candidate)

        self.assertEqual(summary["totals"]["classificationCounts"], {
            "group_only": 1,
            "lead": 1,
            "staff": 1,
            "unknown": 1,
            "vendor": 1,
        })
        self.assertEqual(summary["totals"]["duplicateMessageRecordsSkipped"], 1)
        self.assertEqual(summary["totals"]["invalidMessageRecords"], 1)
        self.assertFalse(summary["containsPii"])

        lead = by_type["lead"][0]
        self.assertEqual(lead["proposedFields"]["name"], "Ana")
        self.assertEqual(lead["proposedFields"]["email"], LEAD_EMAIL)
        self.assertIn("weight_management", lead["proposedFields"]["interests"])
        self.assertEqual(lead["proposedFields"]["suggestedStage"], "appointment_scheduled")
        self.assertEqual(lead["activitySummary"]["messageCount"], 2)
        self.assertEqual(len(lead["identities"]), 2)
        self.assertEqual(lead["matchHints"]["e164"], [LEAD_PHONE])
        self.assertEqual(lead["matchHints"]["emails"], [])
        self.assertTrue(lead["matchHints"]["automaticMatchAllowed"])
        self.assertFalse(lead["classification"]["patientInferredFromMessages"])
        self.assertEqual(lead["classification"]["patientStatus"], "requires_database_treatment_match")
        self.assertLessEqual(len(lead["evidence"]["name"]), 3)
        self.assertNotIn("body", json.dumps(lead))

        group_only = by_type["group_only"][0]
        self.assertEqual(group_only["activitySummary"]["groupMessageCount"], 1)
        self.assertEqual(group_only["activitySummary"]["directMessageCount"], 0)
        self.assertIn("peptides", group_only["proposedFields"]["interests"])
        self.assertNotIn(OWNER_PHONE, json.dumps(document))

        self.assertEqual(rpc["rpc"], "crm_ingest_candidates")
        rpc_payload = rpc["params"]["p_payload"]
        self.assertEqual(rpc_payload["run"]["id"], summary["runId"])
        self.assertEqual(rpc_payload["run"]["idempotencyKey"], summary["runId"])
        self.assertEqual(rpc_payload["run"]["sourceChecksum"], summary["sourceFingerprint"])
        self.assertEqual(len(rpc_payload["candidates"]), len(candidates))
        self.assertTrue(all(item["candidateType"] == "contact_upsert" for item in rpc_payload["candidates"]))
        proposed_types = {item["proposedData"]["contactType"] for item in rpc_payload["candidates"]}
        self.assertIn("supplier", proposed_types)
        self.assertIn("group_only", proposed_types)
        self.assertFalse(any(item["proposedData"]["contactType"] == "patient" for item in rpc_payload["candidates"]))
        self.assertTrue(all(item["proposedData"]["matchHints"]["emails"] == [] for item in rpc_payload["candidates"]))

    def test_outputs_are_private_and_byte_stable(self) -> None:
        document_one, _, _ = extract_candidates(self.config())
        bytes_one = (self.output_dir / "candidates.json").read_bytes()
        document_two, _, _ = extract_candidates(self.config())
        bytes_two = (self.output_dir / "candidates.json").read_bytes()

        self.assertEqual(document_one, document_two)
        self.assertEqual(bytes_one, bytes_two)
        self.assertEqual(os.stat(self.output_dir).st_mode & 0o777, 0o700)
        for filename in ("candidates.json", "summary.json", "rpc-payload.json"):
            self.assertEqual(os.stat(self.output_dir / filename).st_mode & 0o777, 0o600)

    def test_dry_run_writes_nothing_and_stdout_has_no_pii(self) -> None:
        dry_output = self.root / "must-not-exist"
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            exit_code = main([
                "--messages", str(self.messages_path),
                "--catalog", str(self.catalog_path),
                "--rules", str(self.rules_path),
                "--output-dir", str(dry_output),
                "--dry-run",
            ])
        self.assertEqual(exit_code, 0)
        self.assertFalse(dry_output.exists())
        output = stdout.getvalue()
        for private_value in (LEAD_PHONE, LEAD_EMAIL, "Ana", "semaglutida", str(self.messages_path)):
            self.assertNotIn(private_value, output)
        self.assertIn('"writesPerformed":false', output)

    def test_summary_contains_no_contact_pii(self) -> None:
        _, summary, _ = extract_candidates(self.config())
        rendered = json.dumps(summary, ensure_ascii=False)
        for private_value in (
            LEAD_PHONE, LEAD_EMAIL, STAFF_PHONE, VENDOR_PHONE, UNKNOWN_PHONE,
            GROUP_PHONE, OWNER_PHONE, "Ana", "Equipo Healen", "Proveedor Uno",
        ):
            self.assertNotIn(private_value, rendered)

    def test_strict_mode_reports_only_line_number(self) -> None:
        with self.assertRaisesRegex(ValueError, r"line 7") as caught:
            extract_candidates(self.config(strict=True))
        self.assertNotIn("private", str(caught.exception).casefold())

    def test_rejects_non_private_existing_output_directory(self) -> None:
        public_output = self.root / "public-output"
        public_output.mkdir(mode=0o755)
        os.chmod(public_output, 0o755)
        with self.assertRaisesRegex(ValueError, "Private output directory"):
            extract_candidates(self.config(output_dir=public_output, rpc_payload_path=None))
        self.assertEqual(os.stat(public_output).st_mode & 0o777, 0o755)
        self.assertFalse((public_output / "candidates.json").exists())

    def test_preflights_separate_rpc_directory_before_writing_candidates(self) -> None:
        public_rpc_dir = self.root / "public-rpc"
        public_rpc_dir.mkdir(mode=0o755)
        os.chmod(public_rpc_dir, 0o755)
        with self.assertRaisesRegex(ValueError, "Private output directory"):
            extract_candidates(self.config(rpc_payload_path=public_rpc_dir / "rpc.json"))
        self.assertFalse((self.output_dir / "candidates.json").exists())

    def test_idempotency_fingerprint_includes_extraction_options(self) -> None:
        _, summary_default, _ = extract_candidates(self.config(
            dry_run=True, output_dir=None, rpc_payload_path=None,
        ))
        _, summary_without_catalog_only, _ = extract_candidates(self.config(
            dry_run=True, output_dir=None, rpc_payload_path=None, include_catalog_only=False,
        ))
        _, summary_with_more_evidence, _ = extract_candidates(self.config(
            dry_run=True, output_dir=None, rpc_payload_path=None, max_evidence_per_field=4,
        ))
        self.assertNotEqual(summary_default["runId"], summary_without_catalog_only["runId"])
        self.assertNotEqual(summary_default["runId"], summary_with_more_evidence["runId"])

    def test_preflights_rpc_database_limits_before_writing(self) -> None:
        with mock.patch.object(extractor_module, "RPC_MAX_CANDIDATES", 1):
            with self.assertRaisesRegex(ValueError, "candidate limit"):
                extract_candidates(self.config())
        self.assertFalse((self.output_dir / "candidates.json").exists())

    def test_rejects_history_that_changes_during_extraction(self) -> None:
        catalog_digest = extractor_module._file_digest(self.catalog_path)
        messages_digest = extractor_module._file_digest(self.messages_path)
        with mock.patch.object(
            extractor_module,
            "_file_digest",
            side_effect=[catalog_digest, messages_digest, catalog_digest, "0" * 64],
        ):
            with self.assertRaisesRegex(ValueError, "immutable snapshot"):
                extract_candidates(self.config())
        self.assertFalse((self.output_dir / "candidates.json").exists())


if __name__ == "__main__":
    unittest.main()
