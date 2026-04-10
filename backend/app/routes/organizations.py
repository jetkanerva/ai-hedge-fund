from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database.connection import get_db
from app.database.models import Organization, User
from app.models.schemas import OrganizationCreateRequest, OrganizationResponse, UserResponse, AddUserToOrganizationRequest
from app.services.auth import verify_user, get_current_user

router = APIRouter(prefix="/organizations", tags=["organizations"])

@router.post("", response_model=OrganizationResponse)
def create_organization(
    org_data: OrganizationCreateRequest,
    supabase_user = Depends(verify_user),
    db: Session = Depends(get_db)
):
    """Create a new organization and make the creator an admin."""
    email = supabase_user.email
    
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already belongs to an organization."
        )
        
    # Create organization
    new_org = Organization(name=org_data.name)
    db.add(new_org)
    db.commit()
    db.refresh(new_org)
    
    # Create admin user
    new_user = User(
        email=email,
        role="admin",
        organization_id=new_org.id
    )
    db.add(new_user)
    db.commit()
    
    return new_org

@router.get("/users/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get the current user's details including organization."""
    return current_user

@router.post("/users", response_model=UserResponse)
def add_user_to_organization(
    user_data: AddUserToOrganizationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a new user to the organization (admin only)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can add users to the organization."
        )
        
    # Check if user to add already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already belongs to an organization."
        )
        
    new_user = User(
        email=user_data.email,
        role="member",
        organization_id=current_user.organization_id
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return new_user

@router.get("/users", response_model=list[UserResponse])
def get_organization_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all users in the organization."""
    users = db.query(User).filter(User.organization_id == current_user.organization_id).all()
    return users
