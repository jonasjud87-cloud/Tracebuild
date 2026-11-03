from uuid import UUID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.auth import AuthDep, CurrentUser
from app.core.supabase import get_supabase
from app.models.schemas import APIResponse, ProjectCreate
from app.models.norm import ProjectNormCreate
from app.services.project_service import ProjectService
from app.services.norm_assignment_service import assign_norms_to_project
from app.services.geoportal_service import lookup_parcel

router = APIRouter(prefix="/projects", tags=["projects"])


def _require_project_admin(user: CurrentUser) -> None:
    if user.role not in ("org_admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Zugriff verweigert")


@router.get("", response_model=APIResponse)
async def list_projects(user: CurrentUser = AuthDep):
    service = ProjectService(get_supabase())
    projects = await service.list_projects(user.org_id)
    return APIResponse(data=[p.model_dump() for p in projects])


@router.post("", response_model=APIResponse, status_code=201)
async def create_project(body: ProjectCreate, user: CurrentUser = AuthDep):
    service = ProjectService(get_supabase())
    project = await service.create_project(user.org_id, body)
    return APIResponse(data=project.model_dump())


@router.get("/{project_id}", response_model=APIResponse)
async def get_project(project_id: UUID, user: CurrentUser = AuthDep):
    service = ProjectService(get_supabase())
    project = await service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")
    if project.org_id != user.org_id:
        raise HTTPException(status_code=403, detail="Kein Zugriff")
    return APIResponse(data=project.model_dump())


@router.delete("/{project_id}", response_model=APIResponse)
async def delete_project(project_id: UUID, user: CurrentUser = AuthDep):
    _require_project_admin(user)
    service = ProjectService(get_supabase())
    project = await service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")
    if project.org_id != user.org_id:
        raise HTTPException(status_code=403, detail="Kein Zugriff")
    await service.delete_project(project_id)
    return APIResponse(data={"deleted": True})


# ── Project Norms ─────────────────────────────────────────────────────────────

@router.get("/{project_id}/norms", response_model=APIResponse)
async def list_project_norms(project_id: UUID, user: CurrentUser = AuthDep):
    db = get_supabase()
    proj = db.table("projects").select("id").eq("id", str(project_id)).eq("org_id", str(user.org_id)).single().execute()
    if not proj.data:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    res = db.table("project_norms").select("*, norms(*)").eq("project_id", str(project_id)).execute()
    return APIResponse(data=res.data)


@router.post("/{project_id}/norms", response_model=APIResponse, status_code=201)
async def add_project_norm(project_id: UUID, body: ProjectNormCreate, user: CurrentUser = AuthDep):
    db = get_supabase()
    proj = db.table("projects").select("id").eq("id", str(project_id)).eq("org_id", str(user.org_id)).single().execute()
    if not proj.data:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    # norm_id ist Client-Input: ohne diesen Check liesse sich eine fremde org-private Norm verknüpfen.
    norm = (
        db.table("norms")
        .select("id")
        .eq("id", str(body.norm_id))
        .or_(f"org_id.eq.{user.org_id},org_id.is.null")
        .execute()
    )
    if not norm.data:
        raise HTTPException(status_code=404, detail="Norm nicht gefunden")

    res = db.table("project_norms").upsert(
        {"project_id": str(project_id), "norm_id": str(body.norm_id), "added_by": "user"},
        on_conflict="project_id,norm_id",
        ignore_duplicates=True,
    ).execute()
    return APIResponse(data=res.data[0] if res.data else {"norm_id": str(body.norm_id)})


@router.post("/{project_id}/norms/refresh", response_model=APIResponse)
async def refresh_project_norms(project_id: UUID, user: CurrentUser = AuthDep):
    """Re-run automatic norm assignment from the catalog; re-check the Bauzone via geoportal."""
    db = get_supabase()
    proj = db.table("projects").select("location, domain, org_id, parcel_number, bauzone").eq("id", str(project_id)).eq("org_id", str(user.org_id)).single().execute()
    if not proj.data:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    loc = proj.data.get("location", {})
    domain = proj.data.get("domain", "bau")
    canton = loc.get("canton", "")
    municipality = loc.get("municipality", "")

    # Geoportal is only consulted for the Bauzone — norms come from the catalog.
    zone = proj.data.get("bauzone")
    parcel_number = proj.data.get("parcel_number")
    if parcel_number and municipality:
        geo = await lookup_parcel(parcel_number, municipality, canton)
        if geo.get("bauzone"):
            zone = geo["bauzone"]
            db.table("projects").update({"bauzone": zone}).eq("id", str(project_id)).execute()

    count = assign_norms_to_project(
        db,
        project_id=str(project_id),
        org_id=str(user.org_id),
        canton=canton,
        municipality=municipality,
        domain=domain,
    )
    return APIResponse(data={"assigned": count, "zone": zone})
