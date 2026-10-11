from pathlib import Path
import os
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")



SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "django-insecure-change-this-in-production"
)

DEBUG = True

ALLOWED_HOSTS = [
    "127.0.0.1",
    "localhost",
]

INSTALLED_APPS = [
    "daphne",

    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",


    "channels",
    "accounts",
    "chat",
]


MIDDLEWARE = [

    "django.middleware.security.SecurityMiddleware",

    "django.contrib.sessions.middleware.SessionMiddleware",

    "django.middleware.common.CommonMiddleware",

    "django.middleware.csrf.CsrfViewMiddleware",

    "django.contrib.auth.middleware.AuthenticationMiddleware",

    "django.contrib.messages.middleware.MessageMiddleware",

    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]


ROOT_URLCONF = "whatsapp.urls"


TEMPLATES = [

    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",

        "DIRS": [
            BASE_DIR / "templates",
        ],

        "APP_DIRS": True,

        "OPTIONS": {

            "context_processors": [

                "django.template.context_processors.request",

                "django.contrib.auth.context_processors.auth",

                "django.contrib.messages.context_processors.messages",

            ],
        },
    },
]

ASGI_APPLICATION = "whatsapp.asgi.application"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}


DATABASES = {

    "default": {

        "ENGINE": "django.db.backends.mysql",
        "NAME": "whatsapp_db",
        "USER": "root",
        "PASSWORD":"thambu",
        "HOST": "127.0.0.1",
        "PORT": "3306",
    }
}



AUTH_PASSWORD_VALIDATORS = [

    {
        "NAME":"django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },

    {
        "NAME":
        "django.contrib.auth.password_validation.MinimumLengthValidator",
    },

    {
        "NAME":
        "django.contrib.auth.password_validation.CommonPasswordValidator",
    },

    {
        "NAME":
        "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]



LANGUAGE_CODE = "en-us"

TIME_ZONE = "Asia/Kolkata"

USE_I18N = True

USE_TZ = True

STATIC_URL = "static/"

STATICFILES_DIRS = [
    BASE_DIR / "static",
]


MEDIA_URL = "/media/"

MEDIA_ROOT = BASE_DIR / "media"



DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


LOGIN_URL = "/accounts/login/"
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/accounts/login/"



MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"


TIME_ZONE = "Asia/Kolkata"
USE_TZ = True