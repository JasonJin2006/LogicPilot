// lp-lsp - LogicPilot language server (P2 developer ecosystem).
//
// Stdio JSON-RPC (LSP): publishes DSL compiler diagnostics on open/change,
// offers completion from the process library registry, and hover summaries
// for block kinds. Reuses the in-process DSL compiler (parse + semantic)
// and tree-sitter grammar, so diagnostics match `lpcli compile` exactly.
//
// Supported LSP requests:
//   initialize / initialized / shutdown / exit
//   textDocument/didOpen|didChange|didClose   -> publishDiagnostics
//   textDocument/completion                   -> block + core kind items
//   textDocument/hover                        -> block summary
#include <cctype>
#include <cstdint>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#include "logicpilot/dsl/compile.h"
#include "logicpilot/dsl/registry.h"
#include "lsp_json.h"

namespace {

using logicpilot::dsl::CompileResult;
using logicpilot::dsl::Diagnostic;
using logicpilot::dsl::Severity;
using logicpilot::dsl::builtin_process_registry;
using logicpilot::lsp::JsonValue;
using logicpilot::lsp::json_string;
using logicpilot::lsp::parse_json;

// Read one Content-Length framed JSON-RPC message from stdin.
std::optional<std::string> read_message() {
  std::size_t length = 0;
  for (;;) {
    std::string line;
    if (!std::getline(std::cin, line)) {
      return std::nullopt;
    }
    if (!line.empty() && line.back() == '\r') {
      line.pop_back();
    }
    if (line.empty()) {
      break;
    }
    if (line.rfind("Content-Length:", 0) == 0) {
      length = static_cast<std::size_t>(std::stoull(line.substr(15)));
    }
  }
  if (length == 0) {
    return std::nullopt;
  }
  std::string body(length, '\0');
  std::cin.read(body.data(), static_cast<std::streamsize>(length));
  if (std::cin.gcount() != static_cast<std::streamsize>(length)) {
    return std::nullopt;
  }
  return body;
}

void write_message(const std::string& body) {
  std::cout << "Content-Length: " << body.size() << "\r\n\r\n" << body;
  std::cout.flush();
}

std::string message_id(const JsonValue& message) {
  const JsonValue* id = message.find("id");
  if (id == nullptr) {
    return "";
  }
  if (id->is_number()) {
    return std::to_string(static_cast<long long>(id->number_value));
  }
  return id->is_string() ? id->string_value : "";
}

std::string respond(const std::string& id, const std::string& result) {
  return "{\"jsonrpc\":\"2.0\",\"id\":" + id +
         ",\"result\":" + result + "}";
}

std::string respond_error(const std::string& id, long code,
                          const std::string& message) {
  return "{\"jsonrpc\":\"2.0\",\"id\":" + id +
         ",\"error\":{\"code\":" + std::to_string(code) +
         ",\"message\":" + json_string(message) + "}}";
}

std::string notify(const std::string& method, const std::string& params) {
  return "{\"jsonrpc\":\"2.0\",\"method\":" + json_string(method) +
         ",\"params\":" + params + "}";
}

// DSL diagnostics -> LSP Diagnostic[] (1-based span -> 0-based line/char).
std::string diagnostics_json(const std::vector<Diagnostic>& diagnostics) {
  std::string out = "[";
  bool first = true;
  for (const Diagnostic& diagnostic : diagnostics) {
    if (!first) {
      out += ",";
    }
    first = false;
    const auto line = diagnostic.span.line > 0 ? diagnostic.span.line - 1 : 0;
    const auto column =
        diagnostic.span.column > 0 ? diagnostic.span.column - 1 : 0;
    const int severity =
        diagnostic.severity == Severity::kError
            ? 1
            : diagnostic.severity == Severity::kWarning ? 2 : 3;
    out += "{\"range\":{\"start\":{\"line\":" + std::to_string(line) +
           ",\"character\":" + std::to_string(column) +
           "},\"end\":{\"line\":" + std::to_string(line) +
           ",\"character\":" +
           std::to_string(column + diagnostic.span.byte_length) +
           "}},\"severity\":" + std::to_string(severity) +
           ",\"code\":" + json_string(diagnostic.code) +
           ",\"message\":" + json_string(diagnostic.message) + "}";
  }
  return out + "]";
}

void publish_diagnostics(const std::string& uri,
                         const std::vector<Diagnostic>& diagnostics) {
  write_message(notify("textDocument/publishDiagnostics",
                       "{\"uri\":" + json_string(uri) +
                           ",\"diagnostics\":" +
                           diagnostics_json(diagnostics) + "}"));
}

// Completion items: core kinds + process library blocks (with field hints).
std::string completion_json() {
  const std::vector<std::string> core_kinds = {
      "model", "param", "state", "couple", "use", "agent",
      "atomic", "continuous", "experiment", "in", "out", "inout"};
  std::string out = "[";
  bool first = true;
  const auto add_item = [&](const std::string& label,
                            const std::string& detail) {
    if (!first) {
      out += ",";
    }
    first = false;
    out += "{\"label\":" + json_string(label) +
           ",\"kind\":10,\"detail\":" + json_string(detail) + "}";
  };
  for (const std::string& kind : core_kinds) {
    add_item(kind, "core kind / keyword");
  }
  const auto& registry = builtin_process_registry();
  for (const auto& shape : registry.blocks()) {
    std::string detail = "process library block";
    if (!shape.params.empty()) {
      detail += " · fields: ";
      for (std::size_t i = 0; i < shape.params.size(); ++i) {
        if (i > 0) {
          detail += ", ";
        }
        detail += shape.params[i].name;
      }
    }
    add_item(shape.kind, detail);
  }
  return out + "]";
}

// Token at (line, character) in `text`; empty when out of bounds.
std::string token_at(const std::string& text, long line, long character) {
  long current = 0;
  std::size_t offset = 0;
  while (current < line && offset < text.size()) {
    if (text[offset] == '\n') {
      ++current;
    }
    ++offset;
  }
  if (current != line) {
    return "";
  }
  long col = 0;
  while (offset < text.size() && col < character && text[offset] != '\n') {
    ++offset;
    ++col;
  }
  std::size_t start = offset;
  while (start > 0 && (std::isalnum(static_cast<unsigned char>(text[start - 1])) ||
                       text[start - 1] == '_')) {
    --start;
  }
  std::size_t end = offset;
  while (end < text.size() &&
         (std::isalnum(static_cast<unsigned char>(text[end])) ||
          text[end] == '_')) {
    ++end;
  }
  return text.substr(start, end - start);
}

std::string hover_json(const std::string& text, long line, long character) {
  const std::string token = token_at(text, line, character);
  if (token.empty()) {
    return "null";
  }
  const auto& registry = builtin_process_registry();
  const auto* shape = registry.block(token);
  if (shape != nullptr) {
    std::string markdown = "**`" + token + "`** — process library block\n\n";
    if (!shape->ports.empty()) {
      markdown += "ports: ";
      for (std::size_t i = 0; i < shape->ports.size(); ++i) {
        if (i > 0) {
          markdown += ", ";
        }
        markdown += shape->ports[i].name;
      }
      markdown += "\n\n";
    }
    if (!shape->params.empty()) {
      markdown += "fields: ";
      for (std::size_t i = 0; i < shape->params.size(); ++i) {
        if (i > 0) {
          markdown += ", ";
        }
        markdown += shape->params[i].name;
      }
    }
    return "{\"contents\":{\"kind\":\"markdown\",\"value\":" +
           json_string(markdown) + "}}";
  }
  const std::vector<std::string> core_kinds = {
      "model", "param", "state", "couple", "use", "agent",
      "atomic", "continuous", "experiment"};
  for (const std::string& kind : core_kinds) {
    if (token == kind) {
      return "{\"contents\":{\"kind\":\"markdown\",\"value\":" +
             json_string("**`" + token + "`** — core DSL keyword") + "}}";
    }
  }
  return "null";
}

// Extract `params.textDocument.uri` and `params.textDocument.text` (didOpen)
// or the last `contentChanges[].text` (didChange, full sync).
std::string document_uri(const JsonValue& params) {
  const JsonValue* text_document = params.find("textDocument");
  return text_document != nullptr
             ? text_document->string_or("uri", "")
             : "";
}

std::string changed_text(const JsonValue& params) {
  const JsonValue* changes = params.find("contentChanges");
  if (changes == nullptr || !changes->is_array() || changes->array.empty()) {
    return "";
  }
  return changes->array.back().string_or("text", "");
}

}  // namespace

int main() {
#ifdef _WIN32
  // Binary stdio: LSP framing (Content-Length + CRLF) and JSON bodies must
  // round-trip byte-exactly; the CRT text mode would double CRs and
  // translate newlines inside bodies.
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  std::string uri;
  std::string text;
  for (;;) {
    const std::optional<std::string> body = read_message();
    if (!body.has_value()) {
      return 0;
    }
    std::string parse_error;
    const JsonValue message = parse_json(*body, &parse_error);
    const std::string id = message_id(message);
    const std::string method = message.string_or("method", "");

    if (method == "initialize") {
      write_message(respond(
          id,
          "{\"capabilities\":{\"textDocumentSync\":1,"
          "\"completionProvider\":{\"triggerCharacters\":[]},"
          "\"hoverProvider\":true},"
          "\"serverInfo\":{\"name\":\"lp-lsp\",\"version\":\"0.1.0\"}}"));
    } else if (method == "initialized") {
      // no response
    } else if (method == "shutdown") {
      write_message(respond(id, "null"));
    } else if (method == "exit") {
      return 0;
    } else if (method == "textDocument/didOpen") {
      const JsonValue* params = message.find("params");
      if (params != nullptr) {
        uri = document_uri(*params);
        const JsonValue* text_document = params->find("textDocument");
        if (text_document != nullptr) {
          text = text_document->string_or("text", "");
        }
        const CompileResult result = logicpilot::dsl::compile_source(text, uri);
        publish_diagnostics(uri, result.diagnostics);
      }
    } else if (method == "textDocument/didChange") {
      const JsonValue* params = message.find("params");
      if (params != nullptr) {
        uri = document_uri(*params);
        text = changed_text(*params);
        const CompileResult result = logicpilot::dsl::compile_source(text, uri);
        publish_diagnostics(uri, result.diagnostics);
      }
    } else if (method == "textDocument/didClose") {
      const JsonValue* params = message.find("params");
      if (params != nullptr) {
        uri = document_uri(*params);
        publish_diagnostics(uri, {});
      }
    } else if (method == "textDocument/completion") {
      write_message(respond(id, "{\"isIncomplete\":false,\"items\":" +
                                    completion_json() + "}"));
    } else if (method == "textDocument/hover") {
      const JsonValue* params = message.find("params");
      const JsonValue* position =
          params != nullptr ? params->find("position") : nullptr;
      const long line =
          position != nullptr && position->find("line") != nullptr
              ? static_cast<long>(
                    position->find("line")->number_value)
              : 0;
      const long character =
          position != nullptr && position->find("character") != nullptr
              ? static_cast<long>(
                    position->find("character")->number_value)
              : 0;
      write_message(respond(id, hover_json(text, line, character)));
    } else if (!id.empty()) {
      write_message(respond_error(id, -32601,
                                  "method not found: " + method));
    }
  }
}
