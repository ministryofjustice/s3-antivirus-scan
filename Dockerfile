FROM denoland/deno:debian

# The port that your application listens to.
EXPOSE 1993

WORKDIR /app

# Create home directory for deno user and set permissions
RUN mkdir -p /home/deno && chown deno:deno /home/deno

# Prefer not to run as root.
USER deno

# Copy the source files.
COPY ./deno* ./*.ts ./

# Compile the main app so that it doesn't need to be compiled each startup/entry.
# RUN deno cache main.ts

CMD [ "task", "production" ]
