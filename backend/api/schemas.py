"""Pydantic schemas for API request/response."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ----- Tag -----
class TagBase(BaseModel):
    title: str
    bg_color: Optional[str] = None
    fg_color: Optional[str] = None
    icon_before: Optional[str] = None
    icon_after: Optional[str] = None


class TagCreate(BaseModel):
    title: str
    bg_color: Optional[str] = None
    fg_color: Optional[str] = None
    icon_before: Optional[str] = None
    icon_after: Optional[str] = None


class TagUpdate(BaseModel):
    title: Optional[str] = None
    bg_color: Optional[str] = None
    fg_color: Optional[str] = None
    icon_before: Optional[str] = None
    icon_after: Optional[str] = None


class TagResponse(BaseModel):
    tag_id: int
    user_id: int
    title: str
    bg_color: Optional[str] = None
    fg_color: Optional[str] = None
    icon_before: Optional[str] = None
    icon_after: Optional[str] = None
    is_system: bool = False
    video_count: Optional[int] = None  # number of videos with this tag (when from video context)

    class Config:
        from_attributes = True


# ----- Channel -----
class ChannelBase(BaseModel):
    provider_key: Optional[str] = None
    handle: Optional[str] = None
    title: Optional[str] = None
    url: Optional[str] = None
    thumbnail: Optional[str] = None
    banner: Optional[str] = None
    author: Optional[str] = None
    description: Optional[str] = None
    is_enabled_for_auto_download: bool = False
    folder_on_disk: Optional[str] = None


class ChannelCreate(ChannelBase):
    pass


class ChannelUpdate(ChannelBase):
    pass


class ChannelResponse(ChannelBase):
    channel_id: int
    record_created: Optional[datetime] = None
    record_updated: Optional[datetime] = None
    video_count: Optional[int] = None
    video_count_done: Optional[int] = None
    created_by_user_id: Optional[int] = None
    created_by_username: Optional[str] = None

    class Config:
        from_attributes = True


# ----- Video -----
class VideoBase(BaseModel):
    provider_key: str
    channel_id: Optional[int] = None
    title: Optional[str] = None
    upload_date: Optional[datetime] = None
    description: Optional[str] = None
    llm_description_1: Optional[str] = None
    thumbnail: Optional[str] = None
    file_path: Optional[str] = None
    transcode_path: Optional[str] = None
    download_date: Optional[datetime] = None
    duration: Optional[int] = None
    status: Optional[str] = None
    status_percent_complete: Optional[int] = None
    status_message: Optional[str] = None
    is_ignore: bool = False


class VideoCreate(BaseModel):
    provider_key: str
    queue_download: bool = False
    tag_needs_review: bool = True


class VideoUpdate(BaseModel):
    title: Optional[str] = None
    is_ignore: Optional[bool] = None
    status: Optional[str] = None


class VideoResponse(VideoBase):
    video_id: int
    record_created: Optional[datetime] = None
    metadata_last_updated: Optional[datetime] = None
    nfo_last_written: Optional[datetime] = None
    watch_progress_percent: Optional[float] = None
    watch_progress_seconds: Optional[int] = None
    watch_is_finished: Optional[bool] = None
    pending_job_id: Optional[int] = None
    pending_job_type: Optional[str] = None
    tags: Optional[list[TagResponse]] = None
    created_by_user_id: Optional[int] = None
    created_by_username: Optional[str] = None

    class Config:
        from_attributes = True


class VideoListResponse(BaseModel):
    videos: list[VideoResponse]
    total: int


class VideoFilterTagOption(BaseModel):
    tag_id: int
    title: str


class VideoFilterOptionsResponse(BaseModel):
    statuses: list[str]
    tags: list[VideoFilterTagOption]


class LogFilterOptionsResponse(BaseModel):
    subsystems: list[str]


# ----- Job queue -----
class JobQueueCreate(BaseModel):
    job_type: str
    video_id: Optional[int] = None
    channel_id: Optional[int] = None
    other_target_id: Optional[int] = None
    parameter: Optional[str] = None
    extended_parameters: Optional[str] = None
    run_after: Optional[datetime] = None
    priority: int = 50
    scheduler_entry_id: Optional[int] = None
    user_id: Optional[int] = None  # Set by API from request.state, not sent by client


class JobQueueUpdate(BaseModel):
    run_after: Optional[datetime] = None
    priority: Optional[int] = None


class JobQueueResponse(BaseModel):
    job_queue_id: int
    record_created: Optional[datetime] = None
    job_type: str
    video_id: Optional[int] = None
    channel_id: Optional[int] = None
    other_target_id: Optional[int] = None
    parameter: Optional[str] = None
    extended_parameters: Optional[str] = None
    status: str
    status_percent_complete: Optional[int] = None
    status_message: Optional[str] = None
    last_update: Optional[datetime] = None
    completed_flag: bool = False
    warning_flag: bool = False
    error_flag: bool = False
    acknowledge_flag: bool = False
    run_after: Optional[datetime] = None
    priority: Optional[int] = None
    scheduler_entry_id: Optional[int] = None
    user_id: Optional[int] = None
    username: Optional[str] = None

    class Config:
        from_attributes = True


class JobQueueListResponse(BaseModel):
    items: list[JobQueueResponse]
    total: int


class JobQueueFilterOptionsResponse(BaseModel):
    statuses: list[str] = []
    job_types: list[str] = []


class JobQueueScheduledSummary(BaseModel):
    """Minimal job info for dashboard scheduled widget (next/last scheduled)."""
    job_queue_id: int
    run_after: Optional[datetime] = None
    job_type: str = ""


class JobQueueSummaryResponse(BaseModel):
    running: list[JobQueueResponse]
    running_count: int
    queued_count: int
    runnable_count: int
    total_count: int
    errors_count: int
    warnings_count: int
    scheduled_count: int = 0
    next_scheduled_job: Optional[JobQueueScheduledSummary] = None
    last_scheduled_job: Optional[JobQueueScheduledSummary] = None


# ----- Scheduler entry -----
class SchedulerEntryBase(BaseModel):
    name: str
    job_type: str
    cron_expression: str
    video_id: Optional[int] = None
    channel_id: Optional[int] = None
    other_target_id: Optional[int] = None
    parameter: Optional[str] = None
    extended_parameters: Optional[str] = None
    priority: int = 50
    is_enabled: bool = True


class SchedulerEntryCreate(SchedulerEntryBase):
    pass


class SchedulerEntryUpdate(BaseModel):
    name: Optional[str] = None
    job_type: Optional[str] = None
    cron_expression: Optional[str] = None
    video_id: Optional[int] = None
    channel_id: Optional[int] = None
    other_target_id: Optional[int] = None
    parameter: Optional[str] = None
    extended_parameters: Optional[str] = None
    priority: Optional[int] = None
    is_enabled: Optional[bool] = None


class SchedulerEntryResponse(SchedulerEntryBase):
    scheduler_entry_id: int
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    record_created: Optional[datetime] = None
    record_updated: Optional[datetime] = None

    class Config:
        from_attributes = True


# ----- Control -----
class ControlSet(BaseModel):
    value: str


class ControlResponse(BaseModel):
    key: str
    index: Optional[int] = None
    value: Optional[str] = None
    last_update: Optional[datetime] = None


# ----- Charged error -----
class ChargedErrorResponse(BaseModel):
    charged_error_id: int
    error_date: Optional[datetime] = None
    error_code: Optional[str] = None
    message: Optional[str] = None
    is_dismissed: bool = False
