"""Setup.py fallback for older pip versions."""
from setuptools import setup, find_packages

setup(
    name="mock-sso",
    version="1.0.0",
    packages=find_packages(),
    install_requires=[
        "flask>=2.0.0,<4.0.0",
    ],
    python_requires=">=3.8",
)