#!/usr/bin/env python3
"""Ejecuta un archivo .sql contra la base Healen vía Supabase Management API.

Uso:  HEALEN_SBP=sbp_xxx python3 db/run.py db/01_foundation.sql
El token NUNCA se hardcodea (este repo es público): se lee de la env var HEALEN_SBP.
"""
import sys, os, json, urllib.request

SBP = os.environ.get("HEALEN_SBP")
REF = os.environ.get("HEALEN_REF", "densirbwpzsmugoeramc")
if not SBP:
    sys.exit("Falta la variable de entorno HEALEN_SBP (token sbp_ de la Management API).")
URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"

def run_sql(sql: str):
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {SBP}",
        "Content-Type": "application/json",
        "User-Agent": "healen-db-runner/1.0",
    })
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

if __name__ == "__main__":
    path = sys.argv[1]
    sql = open(path).read()
    status, out = run_sql(sql)
    print(f"[{path}] HTTP {status}")
    print(out[:2000] if out else "(sin cuerpo)")
    sys.exit(0 if status < 300 else 1)
