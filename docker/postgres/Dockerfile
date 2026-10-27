ARG GOSU_BUILDER_IMAGE=golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4
ARG POSTGRES_BASE_IMAGE
ARG GOSU_COMMIT=6456aaa0f3c854d199d0f037f068eb97515b7513
ARG GOSU_USER_MODULE_VERSION=v0.4.1

FROM ${GOSU_BUILDER_IMAGE} AS gosu-builder

ARG TARGETOS
ARG TARGETARCH
ARG GOSU_COMMIT
ARG GOSU_USER_MODULE_VERSION

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    git init /src; \
    git -C /src fetch --depth 1 https://github.com/tianon/gosu.git "$GOSU_COMMIT"; \
    git -C /src checkout --detach FETCH_HEAD

WORKDIR /src
RUN set -eux; \
    go mod edit -require="github.com/moby/sys/user@${GOSU_USER_MODULE_VERSION}"; \
    go mod tidy; \
    go mod verify; \
    test "$(go list -m github.com/moby/sys/user)" = "github.com/moby/sys/user ${GOSU_USER_MODULE_VERSION}"; \
    mkdir -p /out; \
    CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" \
      go build -trimpath -buildvcs=false -ldflags='-w' -o /out/gosu .; \
    chmod 0755 /out/gosu; \
    /out/gosu --version

ARG GOSU_BUILDER_IMAGE
ARG POSTGRES_BASE_IMAGE
FROM ${POSTGRES_BASE_IMAGE}

COPY --from=gosu-builder /out/gosu /usr/local/bin/gosu
RUN set -eux; gosu --version; gosu nobody true
ARG GOSU_COMMIT
ARG GOSU_USER_MODULE_VERSION
LABEL org.opencontainers.image.base.name="${POSTGRES_BASE_IMAGE}" \
      io.taky.postgres.gosu.commit="${GOSU_COMMIT}" \
      io.taky.postgres.gosu.user-module="${GOSU_USER_MODULE_VERSION}" \
      io.taky.postgres.gosu.builder="${GOSU_BUILDER_IMAGE}"
