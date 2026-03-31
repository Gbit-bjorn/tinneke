import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    APP_USERNAME: str = os.environ.get("APP_USERNAME", "admin")
    APP_PASSWORD: str = os.environ["APP_PASSWORD"]
    SECRET_KEY: str = os.environ["SECRET_KEY"]
    DATABASE_PATH: str = os.environ.get("DATABASE_PATH", "bk_dpk_lpd_web.db")
    LLINKID_BASE_URL: str = os.environ.get(
        "LLINKID_BASE_URL", "https://api.katholiekonderwijs.vlaanderen"
    )
