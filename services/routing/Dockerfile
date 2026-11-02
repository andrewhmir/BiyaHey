# MOTIS routing service for BiyaHey!.
#
# Pinned release + verified checksum: the tarball is downloaded from the
# motis-project GitHub release and rejected unless its sha256 matches the
# published asset digest for v2.11.4.
FROM debian:bookworm-slim

ARG MOTIS_VERSION=v2.11.4
ARG MOTIS_SHA256=b521bb29c961a3b994ff4dac663778ba64fee7b4cfaf3f2b20ff1d5e1d15e0dc

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl bzip2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL --retry 3 -o /tmp/motis.tar.bz2 \
        "https://github.com/motis-project/motis/releases/download/${MOTIS_VERSION}/motis-linux-amd64.tar.bz2" \
    && echo "${MOTIS_SHA256}  /tmp/motis.tar.bz2" | sha256sum -c - \
    && mkdir -p /opt/motis \
    && tar -xjf /tmp/motis.tar.bz2 -C /opt/motis \
    && rm -f /tmp/motis.tar.bz2 \
    && test -x /opt/motis/motis

ENV PATH="/opt/motis:${PATH}" \
    MOTIS_CONFIG=/etc/motis/config.yml \
    MOTIS_DATA_DIR=/var/lib/motis/data

COPY config/config.yml /etc/motis/config.yml
COPY docker-entrypoint.sh /usr/local/bin/motis-entrypoint
# Normalize CRLF: Windows checkouts (core.autocrlf=true) would otherwise produce
# a /bin/sh^M script that fails with "bad interpreter".
RUN sed -i 's/\r$//' /usr/local/bin/motis-entrypoint \
    && chmod +x /usr/local/bin/motis-entrypoint \
    && mkdir -p /var/lib/motis/data

WORKDIR /var/lib/motis
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/motis-entrypoint"]
