FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv libcairo2 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/stickers
ENV PATH="/opt/stickers/bin:$PATH"
COPY requirements-stickers.txt /tmp/requirements-stickers.txt
RUN pip install --no-cache-dir -r /tmp/requirements-stickers.txt
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
