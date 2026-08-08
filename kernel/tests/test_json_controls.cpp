// Unit tests for the lp-server JSON control-plane helpers (json_controls.h):
// escaping, ack/error envelope validity, and the string/number field parser
// boundaries (missing, escaped, nested, truncated, malformed).
#include <catch2/catch_test_macros.hpp>

#include <string>

#include "json_controls.h"

using namespace logicpilot::server;

TEST_CASE("json_escape escapes JSON metacharacters", "[server][json]") {
  CHECK(json_escape("plain") == "plain");
  CHECK(json_escape("a\"b") == "a\\\"b");
  CHECK(json_escape("a\\b") == "a\\\\b");
  CHECK(json_escape("line1\nline2") == "line1\\nline2");
  CHECK(json_escape("cr\rlf") == "cr\\rlf");
  CHECK(json_escape("tab\there") == "tab\\there");
}

TEST_CASE("json_error and json_ok stay valid with hostile input",
          "[server][json]") {
  // The m2 regression: echoing an unescaped command would emit invalid JSON.
  CHECK(json_error("unknown command 'a\"b'") ==
        "{\"ok\":false,\"error\":\"unknown command 'a\\\"b'\"}");
  CHECK(json_ok("start") == "{\"ok\":true,\"cmd\":\"start\"}");
  CHECK(json_ok("a\nb") == "{\"ok\":true,\"cmd\":\"a\\nb\"}");
}

TEST_CASE("json_string_field extracts flat string values", "[server][json]") {
  std::string out;
  REQUIRE(json_string_field(R"({"cmd":"start"})", "cmd", out));
  CHECK(out == "start");
  REQUIRE(json_string_field(R"({"cmd":""})", "cmd", out));
  CHECK(out.empty());
  REQUIRE(json_string_field(R"({"seed":42,"cmd":"pause"})", "cmd", out));
  CHECK(out == "pause");
  REQUIRE(json_string_field("{\"cmd\":\"a\\\"b\\\\c\\n\"}", "cmd", out));
  CHECK(out == "a\"b\\c\n");
}

TEST_CASE("json_string_field rejects missing or truncated fields",
          "[server][json]") {
  std::string out;
  CHECK_FALSE(json_string_field(R"({"nope":"x"})", "cmd", out));
  CHECK_FALSE(json_string_field(R"({"cmd" start})", "cmd", out));  // no colon
  CHECK_FALSE(json_string_field(R"({"cmd":})", "cmd", out));       // no value
  CHECK_FALSE(json_string_field(R"({"cmd": )", "cmd", out));       // whitespace
  CHECK_FALSE(json_string_field(R"({"cmd":"abc)", "cmd", out));    // no close quote
  CHECK_FALSE(json_string_field(R"({"cmd":"a"b"})", "cmd", out));
  CHECK_FALSE(json_string_field(R"({"nested":{"cmd":"start"}})", "cmd", out));
  CHECK_FALSE(json_string_field(R"([{"cmd":"start"}])", "cmd", out));
}

TEST_CASE("json_number_field parses valid numbers", "[server][json]") {
  double value = 0.0;
  REQUIRE(json_number_field(R"({"speed":50})", "speed", value));
  CHECK(value == 50.0);
  REQUIRE(json_number_field(R"({"speed": 50})", "speed", value));
  CHECK(value == 50.0);
  REQUIRE(json_number_field(R"({"speed":-3.5})", "speed", value));
  CHECK(value == -3.5);
  REQUIRE(json_number_field(R"({"speed":1e3})", "speed", value));
  CHECK(value == 1000.0);
  REQUIRE(json_number_field(R"({"speed":1.5e-2})", "speed", value));
  CHECK(value == 0.015);
  REQUIRE(json_number_field(R"({"arrivals":2000,"speed":50})", "speed", value));
  CHECK(value == 50.0);
}

TEST_CASE("json_number_field rejects malformed numbers", "[server][json]") {
  double value = 0.0;
  CHECK_FALSE(json_number_field(R"({"speed":"50"})", "speed", value));
  CHECK_FALSE(json_number_field(R"({"speed":})", "speed", value));
  CHECK_FALSE(json_number_field(R"({"speed":abc})", "speed", value));
  CHECK_FALSE(json_number_field(R"({"speed":1e})", "speed", value));
  CHECK_FALSE(json_number_field(R"({"speed":--1})", "speed", value));
  CHECK_FALSE(json_number_field(R"({"speed":+2})", "speed", value));
  CHECK_FALSE(json_number_field(R"({"speed":1e999})", "speed", value));
  CHECK_FALSE(json_number_field(R"({"nope":50})", "speed", value));
}
