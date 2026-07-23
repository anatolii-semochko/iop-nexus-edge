FROM golang:1.25-alpine3.22 AS build
WORKDIR /workspace/apps/device-service
RUN apk add --no-cache git

COPY apps/device-service/go.mod apps/device-service/go.sum ./
RUN go mod download

COPY apps/device-service .
RUN CGO_ENABLED=0 go build -trimpath -o /out/device-service ./cmd

FROM alpine:3.22 AS runtime
RUN apk add --no-cache dumb-init && apk --no-cache upgrade
WORKDIR /app
COPY --from=build /out/device-service ./device-service
COPY --from=build /workspace/apps/device-service/res ./res
EXPOSE 59999
ENTRYPOINT ["dumb-init", "--"]
CMD ["./device-service", "-cp=keeper.http://edgex-core-keeper:59890", "--registry"]
