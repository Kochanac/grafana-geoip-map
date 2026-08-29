package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/oschwald/geoip2-golang/v2"
)

type config struct {
	listenAddress  string
	databasePath   string
	allowedOrigins map[string]struct{}
	allowAnyOrigin bool
	maxBatchSize   int
}

type server struct {
	config config
	db     *geoip2.Reader
}

type lookupRequest struct {
	IPs []string `json:"ips"`
}

type lookupResponse struct {
	Results []lookupResult `json:"results"`
}

type lookupResult struct {
	IP             string  `json:"ip"`
	Found          bool    `json:"found"`
	Latitude       float64 `json:"latitude,omitempty"`
	Longitude      float64 `json:"longitude,omitempty"`
	City           string  `json:"city,omitempty"`
	Country        string  `json:"country,omitempty"`
	CountryCode    string  `json:"countryCode,omitempty"`
	AccuracyRadius uint16  `json:"accuracyRadius,omitempty"`
	Error          string  `json:"error,omitempty"`
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	db, err := geoip2.Open(cfg.databasePath)
	if err != nil {
		log.Fatalf("open GeoIP database %q: %v", cfg.databasePath, err)
	}
	defer db.Close()

	app := &server{config: cfg, db: db}
	httpServer := &http.Server{
		Addr:              cfg.listenAddress,
		Handler:           app.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	shutdownSignals := make(chan os.Signal, 1)
	signal.Notify(shutdownSignals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-shutdownSignals
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			log.Printf("graceful shutdown: %v", err)
		}
	}()

	log.Printf("GeoIP service listening on %s using %s", cfg.listenAddress, cfg.databasePath)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func loadConfig() (config, error) {
	maxBatchSize := 1000
	if raw := os.Getenv("MAX_BATCH_SIZE"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 {
			return config{}, fmt.Errorf("MAX_BATCH_SIZE must be a positive integer")
		}
		maxBatchSize = value
	}

	origins := envOrDefault("ALLOWED_ORIGINS", "http://localhost:3000")
	allowedOrigins := make(map[string]struct{})
	allowAnyOrigin := false
	for _, origin := range strings.Split(origins, ",") {
		origin = strings.TrimSpace(origin)
		if origin == "*" {
			allowAnyOrigin = true
		} else if origin != "" {
			allowedOrigins[origin] = struct{}{}
		}
	}

	return config{
		listenAddress:  envOrDefault("LISTEN_ADDRESS", ":8080"),
		databasePath:   envOrDefault("GEOIP_DB_PATH", "/data/GeoLite2-City.mmdb"),
		allowedOrigins: allowedOrigins,
		allowAnyOrigin: allowAnyOrigin,
		maxBatchSize:   maxBatchSize,
	}, nil
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /v1/lookup", s.handleLookup)
	mux.HandleFunc("OPTIONS /v1/lookup", s.handleOptions)
	return s.withCORS(mux)
}

func (s *server) handleHealth(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) handleOptions(response http.ResponseWriter, _ *http.Request) {
	response.WriteHeader(http.StatusNoContent)
}

func (s *server) handleLookup(response http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(response, request.Body, 1<<20)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()

	var payload lookupRequest
	if err := decoder.Decode(&payload); err != nil {
		writeError(response, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if len(payload.IPs) == 0 {
		writeError(response, http.StatusBadRequest, "ips must contain at least one address")
		return
	}
	if len(payload.IPs) > s.config.maxBatchSize {
		writeError(response, http.StatusRequestEntityTooLarge, fmt.Sprintf("batch exceeds limit of %d IPs", s.config.maxBatchSize))
		return
	}

	results := make([]lookupResult, 0, len(payload.IPs))
	for _, rawIP := range payload.IPs {
		results = append(results, s.lookup(strings.TrimSpace(rawIP)))
	}
	writeJSON(response, http.StatusOK, lookupResponse{Results: results})
}

func (s *server) lookup(rawIP string) lookupResult {
	result := lookupResult{IP: rawIP}
	address, err := netip.ParseAddr(rawIP)
	if err != nil {
		result.Error = "invalid IP address"
		return result
	}
	if !address.IsGlobalUnicast() || address.IsPrivate() {
		result.Error = "not a public IP address"
		return result
	}

	record, err := s.db.City(address)
	if err != nil {
		result.Error = "GeoIP lookup failed"
		return result
	}
	if !record.HasData() {
		result.Error = "address not found"
		return result
	}
	if record.Location.Latitude == nil || record.Location.Longitude == nil {
		result.Error = "coordinates not available"
		return result
	}

	result.Found = true
	result.Latitude = *record.Location.Latitude
	result.Longitude = *record.Location.Longitude
	result.City = record.City.Names.English
	result.Country = record.Country.Names.English
	result.CountryCode = record.Country.ISOCode
	result.AccuracyRadius = record.Location.AccuracyRadius
	return result
}

func (s *server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		origin := request.Header.Get("Origin")
		_, originAllowed := s.config.allowedOrigins[origin]
		if origin != "" && !s.config.allowAnyOrigin && !originAllowed {
			writeError(response, http.StatusForbidden, "origin is not allowed")
			return
		}
		if origin != "" {
			if s.config.allowAnyOrigin {
				response.Header().Set("Access-Control-Allow-Origin", "*")
			} else {
				response.Header().Set("Access-Control-Allow-Origin", origin)
				response.Header().Set("Vary", "Origin")
			}
			response.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			response.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		}
		next.ServeHTTP(response, request)
	})
}

func writeError(response http.ResponseWriter, status int, message string) {
	writeJSON(response, status, map[string]string{"error": message})
}

func writeJSON(response http.ResponseWriter, status int, payload any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	if err := json.NewEncoder(response).Encode(payload); err != nil {
		log.Printf("encode response: %v", err)
	}
}
