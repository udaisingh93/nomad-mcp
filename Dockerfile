# nomad-mcp over streamable HTTP, for running as a sidecar or service.
# stdio still works: docker run -i --rm -e MCP_TRANSPORT=stdio ...
FROM node:22-slim

WORKDIR /opt/nomad-mcp
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && rm -rf /root/.npm
COPY src ./src

ENV MCP_TRANSPORT=http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8000

USER 10001
EXPOSE 8000
ENTRYPOINT ["node", "/opt/nomad-mcp/src/index.js"]
