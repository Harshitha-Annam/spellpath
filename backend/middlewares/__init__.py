"""Middleware registration."""

from fastapi import FastAPI

from .cors import register_cors


def register_middlewares(app: FastAPI) -> None:
    register_cors(app)
