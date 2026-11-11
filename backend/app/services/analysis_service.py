"""
Plan-Analyse gegen projektspezifische Normen.

Ablauf:
  1. Lade alle project_norms des Projekts (mit Norm-Inhalt)
  2. Erstelle Norm-Kontext als strukturierten Text
  3. Rufe Claude Vision auf — kein Tool-Use, direkter JSON-Output
  4. Validiere Output gegen AnalysisCheckItem-Schema
  5. Bei Parse-Fehler: einmaliger Retry
  6. Speichere Prüfpunkte als analysis_items (inkl. norm_id, category, confidence)
  7. Logge cost_usd in analyses-Tabelle
"""
from __future__ import annotations
import base64
import json
import logging
import uuid
from datetime import datetime, timezone
from uuid import UUID

import anthropic
from supabase import Client

from app.core.config import settings
from app.models.schemas import (
    AnalysisOut,
    AnalysisItemOut,
    AnalysisCheckItem,
    VALID_CATEGORIES,
    VALID_STATUSES,
    VALID_CONFIDENCES,
)
from app.services.zone_match import norm_matches_zone

logger = logging.getLogger(__name__)

# ── Prompt ────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Du bist ein Schweizer Baurechtsexperte und prüfst Baupläne auf Normkonformität.

Dir werden folgende Informationen übergeben:
- Bilder der Baupläne (PDF-Seiten als Bilder)
- Eine Liste der gültigen Normen für dieses Projekt (Titel + Inhalt)
- Projektkontext: Gemeinde, Kanton, Bauzone

Deine Aufgabe:
- Prüfe jeden Plan gegen die übergebenen Normen
- Identifiziere für jede relevante Norm ob sie erfüllt ist (ok), nicht erfüllt (fail) oder unklar ist (warn)
- Begründe jeden Befund konkret mit Bezug auf den Plan
- Bei fail/warn: gib eine konkrete Verbesserungsempfehlung
- Sei präzise, kein Blabla — ein Architekt liest das

Antworte AUSSCHLIESSLICH mit einem JSON-Array von Prüfpunkten. Kein Text davor oder danach.

Schema für jeden Eintrag:
{
  "check_id": "<uuid>",
  "norm_id": "<norm-id aus der Liste oder null>",
  "norm_title": "<Titel der geprüften Norm>",
  "category": "<grenzabstand|gebaeudehöhe|erschliessung|brandschutz|parkierung|andere>",
  "status": "<ok|fail|warn>",
  "finding": "<was konkret im Plan erkannt/gemessen wurde>",
  "suggestion": "<Verbesserungsempfehlung oder null bei ok>",
  "confidence": "<high|medium|low>",
  "page_reference": <Seitennummer als Integer oder null>
}"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_norm_context(norms: list[dict], project_zone: str | None) -> str:
    applicable = [
        n for n in norms
        if norm_matches_zone((n.get("norms") or n).get("zone"), project_zone)
    ]
    if not applicable:
        return "Keine projektspezifischen Normen hinterlegt. Nutze dein Fachwissen über Schweizer Bauvorschriften."

    lines = [f"NORMEN ({len(applicable)} projektspezifische Normen):\n"]
    for i, n in enumerate(applicable, 1):
        norm = n.get("norms") or n
        lines.append(
            f"[{i}] Norm-ID: {norm.get('id', '')}\n"
            f"    Titel: {norm.get('title', '')}\n"
            f"    Kategorie: {norm.get('category', '')}\n"
            f"    Inhalt: {norm.get('text', '')}"
        )
    return "\n\n".join(lines)


def _error_fields(reason: object) -> dict[str, object]:
    """Fehlerabschluss immer mit Grund und Endzeit, sonst zeigt die Seite keinen Grund."""
    text = str(reason).strip()[:300] or type(reason).__name__ or "Unbekannter Fehler"
    return {
        "status": "error",
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "result_json": {"error": text},
    }


def _parse_items(raw: str) -> list[AnalysisCheckItem]:
    # Strip markdown code fences if present
    if "```json" in raw:
        raw = raw.split("```json")[1].split("```")[0].strip()
    elif "```" in raw:
        raw = raw.split("```")[1].split("```")[0].strip()

    data = json.loads(raw.strip())
    if not isinstance(data, list):
        raise ValueError("Expected JSON array")

    items: list[AnalysisCheckItem] = []
    for obj in data:
        item = AnalysisCheckItem(
            check_id=obj.get("check_id") or str(uuid.uuid4()),
            norm_id=obj.get("norm_id"),
            norm_title=str(obj.get("norm_title") or ""),
            category=obj.get("category") or "andere",
            status=obj.get("status") or "warn",
            finding=str(obj.get("finding") or obj.get("note") or ""),
            suggestion=obj.get("suggestion"),
            confidence=obj.get("confidence") or "medium",
            page_reference=int(obj["page_reference"]) if obj.get("page_reference") else None,
        ).normalize()
        items.append(item)
    return items


# ── Service ───────────────────────────────────────────────────────────────────

class AnalysisService:
    def __init__(self, db: Client) -> None:
        self.db = db
        self.claude = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    async def run_analysis(
        self,
        document_id: UUID,
        project_id: UUID,
        domain_id: str,
        file_bytes: bytes = b"",
        content_type: str = "application/pdf",
        location: dict = {},
        bauzone: str | None = None,
    ) -> AnalysisOut:
        # Create analysis record
        res = (
            self.db.table("analyses")
            .insert({"document_id": str(document_id), "status": "running"})
            .execute()
        )
        analysis_id: str = res.data[0]["id"]

        try:
            # 1. Load project norms
            norms_res = (
                self.db.table("project_norms")
                .select("*, norms(*)")
                .eq("project_id", str(project_id))
                .execute()
            )
            norms = norms_res.data or []
            norm_context = _build_norm_context(norms, bauzone)

            # 2. Encode file
            encoded = base64.standard_b64encode(file_bytes).decode("utf-8")
            is_pdf = "pdf" in content_type.lower()
            if is_pdf:
                file_block: dict = {
                    "type": "document",
                    "source": {"type": "base64", "media_type": "application/pdf", "data": encoded},
                }
            else:
                media = content_type if content_type.startswith("image/") else "image/jpeg"
                file_block = {
                    "type": "image",
                    "source": {"type": "base64", "media_type": media, "data": encoded},
                }

            canton = location.get("canton", "")
            municipality = location.get("municipality", "")

            user_text = (
                f"PROJEKTKONTEXT:\n"
                f"- Gemeinde: {municipality}\n"
                f"- Kanton: {canton}\n"
                f"- Bauzone: {bauzone or 'unbekannt'}\n\n"
                f"{norm_context}\n\n"
                f"Analysiere den beigefügten Bauplan gegen alle genannten Normen.\n"
                f"Gib für jede Norm mindestens einen Prüfpunkt aus."
            )

            messages = [
                {
                    "role": "user",
                    "content": [file_block, {"type": "text", "text": user_text}],
                }
            ]

            # 3. First attempt
            response = self.claude.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=8192,
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                messages=messages,
            )
            total_input = response.usage.input_tokens
            total_output = response.usage.output_tokens

            raw_text = next((b.text for b in response.content if hasattr(b, "text")), "[]")

            # 4. Parse with one retry on failure
            try:
                items = _parse_items(raw_text)
            except Exception as parse_err:
                logger.warning("First parse failed (%s), retrying…", parse_err)
                retry = self.claude.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=8192,
                    system=[{"type": "text", "text": SYSTEM_PROMPT}],
                    messages=[
                        *messages,
                        {"role": "assistant", "content": raw_text},
                        {
                            "role": "user",
                            "content": (
                                "Deine Antwort konnte nicht als valides JSON geparst werden. "
                                "Gib NUR das JSON-Array aus, absolut kein anderer Text."
                            ),
                        },
                    ],
                )
                total_input += retry.usage.input_tokens
                total_output += retry.usage.output_tokens
                raw_text = next((b.text for b in retry.content if hasattr(b, "text")), "[]")
                try:
                    items = _parse_items(raw_text)
                except Exception:
                    self.db.table("analyses").update(
                        _error_fields("Antwort des Modells nicht lesbar")
                    ).eq("id", analysis_id).execute()
                    raise

            # 5. Cost
            cost_usd = total_input * 3.0 / 1_000_000 + total_output * 15.0 / 1_000_000

            # 6. Save items
            if items:
                payload = [
                    {
                        "analysis_id": analysis_id,
                        "norm_id": item.norm_id,
                        "norm_title": item.norm_title,
                        "category": item.category,
                        "status": item.status,
                        "note": item.finding,          # 'note' column = finding text
                        "suggestion": item.suggestion,
                        "confidence": item.confidence,
                        "page_reference": item.page_reference,
                    }
                    for item in items
                ]
                self.db.table("analysis_items").insert(payload).execute()

            self.db.table("analyses").update(
                {"status": "done", "cost_usd": cost_usd, "result_json": {"raw": raw_text}}
            ).eq("id", analysis_id).execute()

            return await self._get_analysis(UUID(analysis_id))

        except Exception as e:
            self.db.table("analyses").update(_error_fields(e)).eq("id", analysis_id).execute()
            raise e

    async def _get_analysis(self, analysis_id: UUID) -> AnalysisOut:
        res = (
            self.db.table("analyses")
            .select("*, analysis_items(*)")
            .eq("id", str(analysis_id))
            .single()
            .execute()
        )
        data = res.data
        items = [AnalysisItemOut(**i) for i in data.pop("analysis_items", [])]
        return AnalysisOut(**data, items=items)
