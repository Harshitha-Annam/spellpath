from pydantic import BaseModel, Field


class QueueJoinBody(BaseModel):
    user_id: str = Field(..., min_length=1)
    display_name: str = Field(..., min_length=1, max_length=24)


class QueueLeaveBody(BaseModel):
    user_id: str = Field(..., min_length=1)


class BotDuelBody(BaseModel):
    user_id: str = Field(..., min_length=1)
    display_name: str = Field(..., min_length=1, max_length=24)


class ForfeitBody(BaseModel):
    user_id: str = Field(..., min_length=1)
