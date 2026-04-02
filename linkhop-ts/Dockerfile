FROM denoland/deno:latest

WORKDIR /app

COPY deno.json deno.lock* ./
COPY src/ src/

RUN deno cache src/main.ts

COPY public/ public/

EXPOSE 8000

VOLUME /app/data

CMD ["run", "-A", "--watch", "src/main.ts"]
