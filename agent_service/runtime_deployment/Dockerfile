# A2.2 ONLY: synthetic, offline security probe. Not the AI agent runtime.
# Pinned Docker Official Python multiarch index (verified 2026-11-22); review monthly.
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY --chown=65532:65532 sandbox_probe.py /opt/geo-rafidain/sandbox_probe.py
USER 65532:65532
ENTRYPOINT ["python3", "-I", "-B", "/opt/geo-rafidain/sandbox_probe.py"]
