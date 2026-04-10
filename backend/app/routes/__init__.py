from fastapi import APIRouter, Depends
from app.services.auth import verify_user, get_current_user

from app.routes.hedge_fund import router as hedge_fund_router
from app.routes.health import router as health_router
from app.routes.storage import router as storage_router
from app.routes.flows import router as flows_router
from app.routes.flow_runs import router as flow_runs_router
from app.routes.ollama import router as ollama_router
from app.routes.language_models import router as language_models_router
from app.routes.api_keys import router as api_keys_router
from app.routes.organizations import router as organizations_router

# Main API router
api_router = APIRouter()

# Include sub-routers
api_router.include_router(health_router, tags=["health"])

# We add organizations router without `get_current_user` globally, since it has mixed requirements
api_router.include_router(organizations_router)

protected_router = APIRouter(dependencies=[Depends(get_current_user)])
protected_router.include_router(hedge_fund_router, tags=["hedge-fund"])
protected_router.include_router(storage_router, tags=["storage"])
protected_router.include_router(flows_router, tags=["flows"])
protected_router.include_router(flow_runs_router, tags=["flow-runs"])
protected_router.include_router(ollama_router, tags=["ollama"])
protected_router.include_router(language_models_router, tags=["language-models"])
protected_router.include_router(api_keys_router, tags=["api-keys"])

api_router.include_router(protected_router)

