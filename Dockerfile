FROM denoland/deno:debian

# Create home directory for deno user and set permissions
RUN mkdir -p /home/deno && chown deno:deno /home/deno

# Set working directory.
WORKDIR /home/deno/app

# Prefer not to run as root.
USER deno

# Copy the source files.
COPY ./deno* ./*.ts ./
COPY ./controllers/*.ts ./controllers/

# Install Deno dependencies.
RUN deno install

# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

CMD [ "task", "production" ]
