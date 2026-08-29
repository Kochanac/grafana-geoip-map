package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLookupRejectsInvalidAndPrivateAddresses(t *testing.T) {
	app := &server{}

	invalid := app.lookup("not-an-ip")
	if invalid.Found || invalid.Error != "invalid IP address" {
		t.Fatalf("unexpected invalid-address result: %+v", invalid)
	}

	private := app.lookup("192.168.1.10")
	if private.Found || private.Error != "not a public IP address" {
		t.Fatalf("unexpected private-address result: %+v", private)
	}
}

func TestLookupEndpointPreservesInputOrder(t *testing.T) {
	app := &server{
		config: config{
			allowAnyOrigin: true,
			maxBatchSize:   10,
		},
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/lookup", strings.NewReader(
		`{"ips":["bad-address","10.0.0.1"]}`,
	))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	app.routes().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected HTTP 200, got %d: %s", response.Code, response.Body.String())
	}
	expected := `"ip":"bad-address"`
	if !strings.Contains(response.Body.String(), expected) {
		t.Fatalf("expected first input in response: %s", response.Body.String())
	}
}

func TestCORSRejectsUnknownOrigin(t *testing.T) {
	app := &server{
		config: config{
			allowedOrigins: map[string]struct{}{"https://grafana.example.com": {}},
		},
	}
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("Origin", "https://untrusted.example.com")
	response := httptest.NewRecorder()

	app.routes().ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected HTTP 403, got %d", response.Code)
	}
}

func TestLoadConfigRejectsInvalidBatchSize(t *testing.T) {
	t.Setenv("MAX_BATCH_SIZE", "zero")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected invalid MAX_BATCH_SIZE to fail")
	}
}
