FROM node:24-slim
ARG CLAUDE_CODE_VERSION=2.1.289
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl bash ripgrep \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 --shell /bin/bash joserah \
 && mkdir -p /workspace /home/joserah/.claude /home/joserah/state /opt/joserah \
 && chown -R joserah:joserah /workspace /home/joserah /opt/joserah
USER joserah
ENV PATH=/opt/joserah/server/docker:/home/joserah/.local/bin:$PATH \
    CLAUDE_CONFIG_DIR=/home/joserah/.claude \
    DISABLE_AUTOUPDATER=1 \
    JOSERAH_IN_DOCKER=1 \
    JOSERAH_STATE_DIR=/home/joserah/state \
    LANG=C.UTF-8
RUN curl -fsSL https://claude.ai/install.sh | bash -s "${CLAUDE_CODE_VERSION}" \
 && /home/joserah/.local/bin/claude --version
COPY --chown=joserah:joserah . /opt/joserah
RUN cd /opt/joserah/server && npm ci --omit=dev && chmod +x /opt/joserah/server/docker/claude
WORKDIR /workspace
VOLUME ["/workspace", "/home/joserah/.claude", "/home/joserah/state"]
EXPOSE 4747
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4747/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "/opt/joserah/server/main.ts", "--workspace", "/workspace"]
