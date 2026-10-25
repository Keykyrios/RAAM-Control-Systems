from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "RAAM Spare-Parts Control"
    environment: str = "development"
    database_url: str = "sqlite:///./raam_control.db"
    cors_origins: str = "http://localhost:5173"
    demo_mode: bool = True
    secret_key: str = "change-me-before-deployment"
    vision_provider_url: str | None = None
    vision_provider_api_key: str | None = None
    vision_max_image_bytes: int = 10_485_760
    vision_provider_timeout_seconds: float = 30.0
    vision_max_concurrent_requests: int = 3
    vision_allow_https_evidence: bool = False
    live_camera_min_interval_ms: int = 1500
    live_camera_max_interval_ms: int = 30_000
    live_camera_default_interval_ms: int = 4000
    live_camera_max_frame_side: int = 1280

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
