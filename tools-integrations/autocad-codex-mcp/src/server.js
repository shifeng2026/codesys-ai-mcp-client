#!/usr/bin/env node
import readline from "node:readline";
import { callAutoCAD } from "./autocad.js";

const SERVER_INFO = {
  name: "autocad-codex-mcp",
  version: "0.1.0"
};

const PROTOCOL_VERSION = "2024-11-05";

const pointSchema = {
  oneOf: [
    {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: { type: "number" }
    },
    {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" }
      },
      required: ["x", "y"],
      additionalProperties: false
    }
  ]
};

const commonConnectionProperties = {
  progId: {
    type: "string",
    description: "Optional COM ProgID override, for example AutoCAD.Application.26."
  },
  startIfMissing: {
    type: "boolean",
    description: "Start AutoCAD through COM if no running instance is available."
  },
  timeoutMs: {
    type: "integer",
    minimum: 1000,
    description: "PowerShell bridge timeout in milliseconds."
  }
};

const layerProperty = {
  layer: {
    type: "string",
    description: "Optional AutoCAD layer name. The layer is created when missing."
  }
};

const tools = [
  {
    name: "autocad_status",
    description: "Check whether AutoCAD is reachable through COM Automation. Does not start AutoCAD unless startIfMissing is true.",
    inputSchema: {
      type: "object",
      properties: commonConnectionProperties,
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("status", args)
  },
  {
    name: "autocad_new_drawing",
    description: "Create a new AutoCAD drawing, optionally from a template.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        templatePath: { type: "string" }
      },
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("new_drawing", args)
  },
  {
    name: "autocad_open_drawing",
    description: "Open an existing DWG/DXF file in AutoCAD.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        filePath: { type: "string" },
        readOnly: { type: "boolean" }
      },
      required: ["filePath"],
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("open_drawing", args)
  },
  {
    name: "autocad_save_as",
    description: "Save the active AutoCAD document to a target file path.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        filePath: { type: "string" },
        overwrite: { type: "boolean" }
      },
      required: ["filePath"],
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("save_as", args)
  },
  {
    name: "autocad_set_layer",
    description: "Create or update a layer in the active drawing.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        name: { type: "string" },
        color: {
          type: "integer",
          minimum: 1,
          maximum: 255,
          description: "AutoCAD color index."
        },
        createIfMissing: { type: "boolean" },
        makeActive: { type: "boolean" }
      },
      required: ["name"],
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("set_layer", args)
  },
  {
    name: "autocad_draw_line",
    description: "Draw a line in ModelSpace of the active drawing.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        ...layerProperty,
        start: pointSchema,
        end: pointSchema
      },
      required: ["start", "end"],
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("draw_line", args)
  },
  {
    name: "autocad_draw_polyline",
    description: "Draw a lightweight 2D polyline in ModelSpace.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        ...layerProperty,
        points: {
          type: "array",
          minItems: 2,
          items: pointSchema
        },
        closed: { type: "boolean" }
      },
      required: ["points"],
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("draw_polyline", args)
  },
  {
    name: "autocad_draw_rectangle",
    description: "Draw a closed lightweight polyline rectangle from origin, width, and height.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        ...layerProperty,
        origin: pointSchema,
        width: { type: "number" },
        height: { type: "number" }
      },
      required: ["origin", "width", "height"],
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("draw_rectangle", args)
  },
  {
    name: "autocad_draw_circle",
    description: "Draw a circle in ModelSpace.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        ...layerProperty,
        center: pointSchema,
        radius: { type: "number", exclusiveMinimum: 0 }
      },
      required: ["center", "radius"],
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("draw_circle", args)
  },
  {
    name: "autocad_add_text",
    description: "Add single-line text to ModelSpace.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        ...layerProperty,
        text: { type: "string" },
        point: pointSchema,
        height: { type: "number", exclusiveMinimum: 0 },
        rotationDeg: { type: "number" }
      },
      required: ["text", "point", "height"],
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("add_text", args)
  },
  {
    name: "autocad_run_command",
    description: "Send a raw AutoCAD command string to the active document. Blocked unless AUTOCAD_MCP_ALLOW_COMMANDS=1 or unsafeAcknowledged=true.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        command: { type: "string" },
        waitMs: { type: "integer", minimum: 0 },
        unsafeAcknowledged: { type: "boolean" }
      },
      required: ["command"],
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("run_command", args)
  },
  {
    name: "autocad_run_script",
    description: "Send multiple raw AutoCAD command lines to the active document. Blocked unless AUTOCAD_MCP_ALLOW_COMMANDS=1 or unsafeAcknowledged=true.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonConnectionProperties,
        commands: {
          type: "array",
          minItems: 1,
          items: { type: "string" }
        },
        waitMs: { type: "integer", minimum: 0 },
        unsafeAcknowledged: { type: "boolean" }
      },
      required: ["commands"],
      additionalProperties: false
    },
    handler: (args) => callAutoCAD("run_script", args)
  }
];

const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  void handleLine(trimmed);
});

process.stdin.on("end", () => {
  process.exit(0);
});

async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    sendError(null, -32700, `Parse error: ${error.message}`);
    return;
  }

  if (!message || message.jsonrpc !== "2.0") {
    sendError(message?.id ?? null, -32600, "Invalid JSON-RPC message.");
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, "id")) {
    await handleNotification(message);
    return;
  }

  try {
    const result = await handleRequest(message);
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    if (error?.mcpError) {
      sendError(message.id, error.code, error.message, error.data);
      return;
    }
    sendError(message.id, -32603, error.message || "Internal error.", error.details);
  }
}

async function handleNotification(message) {
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
    return;
  }
  log(`Ignoring notification: ${message.method}`);
}

async function handleRequest(message) {
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {}
        },
        serverInfo: SERVER_INFO
      };
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: tools.map(({ handler, ...tool }) => tool)
      };
    case "tools/call":
      return callTool(message.params);
    default:
      throw mcpError(-32601, `Method not found: ${message.method}`);
  }
}

async function callTool(params = {}) {
  const name = params.name;
  const args = params.arguments || {};
  const tool = toolMap.get(name);

  if (!tool) {
    throw mcpError(-32602, `Unknown tool: ${name}`);
  }

  try {
    const result = await tool.handler(args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: formatToolError(error)
        }
      ]
    };
  }
}

function formatToolError(error) {
  const details = error.details
    ? `\n\nDetails:\n${JSON.stringify(error.details, null, 2)}`
    : "";
  return `${error.message || "Tool failed."}${details}`;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(id, code, message, data = undefined) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  send({ jsonrpc: "2.0", id, error });
}

function mcpError(code, message, data = undefined) {
  const error = new Error(message);
  error.mcpError = true;
  error.code = code;
  error.data = data;
  return error;
}

function log(message) {
  process.stderr.write(`[autocad-codex-mcp] ${message}\n`);
}
