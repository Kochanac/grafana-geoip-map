FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /geoip-service .

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /geoip-service /geoip-service
EXPOSE 8080
ENTRYPOINT ["/geoip-service"]
