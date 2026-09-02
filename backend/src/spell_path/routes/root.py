from fastapi import APIRouter

from spell_path.controllers import root as root_controller

router = APIRouter(tags=["root"])


@router.get("/")
def root():
    return root_controller.root()
