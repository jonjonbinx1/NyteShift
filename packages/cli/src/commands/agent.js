"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAgentCommands = registerAgentCommands;
var chalk_1 = require("chalk");
var core_1 = require("@nyteshift/core");
function registerAgentCommands(program) {
    var _this = this;
    var agent = program.command("agent").description("Manage agents");
    // ── nyteshift agent list ──────────────────────────────────────────────
    agent
        .command("list")
        .description("List all agents")
        .action(function () { return __awaiter(_this, void 0, void 0, function () {
        var agents, _i, agents_1, name_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, core_1.listAgents)()];
                case 1:
                    agents = _a.sent();
                    if (agents.length === 0) {
                        console.log(chalk_1.default.yellow("No agents found. Create one with: nyteshift agent create <name>"));
                        return [2 /*return*/];
                    }
                    console.log(chalk_1.default.bold("Agents:"));
                    for (_i = 0, agents_1 = agents; _i < agents_1.length; _i++) {
                        name_1 = agents_1[_i];
                        console.log("  \u2022 ".concat(name_1));
                    }
                    return [2 /*return*/];
            }
        });
    }); });
    // ── nyteshift agent create <name> ─────────────────────────────────────
    agent
        .command("create <name>")
        .description("Create a new agent")
        .action(function (name) { return __awaiter(_this, void 0, void 0, function () {
        var config, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, core_1.createAgent)(name)];
                case 1:
                    config = _a.sent();
                    console.log(chalk_1.default.green("\u2714 Agent \"".concat(config.name, "\" created.")));
                    return [3 /*break*/, 3];
                case 2:
                    err_1 = _a.sent();
                    console.error(chalk_1.default.red("\u2716 ".concat(err_1.message)));
                    process.exitCode = 1;
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // ── nyteshift agent delete <name> ─────────────────────────────────────
    agent
        .command("delete <name>")
        .description("Delete an agent")
        .action(function (name) { return __awaiter(_this, void 0, void 0, function () {
        var err_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, core_1.deleteAgent)(name)];
                case 1:
                    _a.sent();
                    console.log(chalk_1.default.green("\u2714 Agent \"".concat(name, "\" deleted.")));
                    return [3 /*break*/, 3];
                case 2:
                    err_2 = _a.sent();
                    console.error(chalk_1.default.red("\u2716 ".concat(err_2.message)));
                    process.exitCode = 1;
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // ── nyteshift agent run <name> "<task>" ─────────────────────────────────
    agent
        .command("run <name> <task>")
        .description("Run an autonomous task with an agent")
        .option("-p, --provider <provider>", "Provider id")
        .option("-m, --model <model>", "Model id")
        .option("--max-steps <n>", "Maximum pipeline steps", "10")
        .action(function (name, task, opts) { return __awaiter(_this, void 0, void 0, function () {
        var result, err_3;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    console.log(chalk_1.default.cyan("Running task with agent \"".concat(name, "\"\u2026")));
                    return [4 /*yield*/, (0, core_1.runAutonomousTask)(name, task, {
                            provider: opts.provider,
                            model: opts.model,
                            maxSteps: parseInt((_a = opts.maxSteps) !== null && _a !== void 0 ? _a : "10", 10),
                        })];
                case 1:
                    result = _b.sent();
                    console.log(chalk_1.default.bold("\n── Result ──────────────────────────────"));
                    console.log(result.finalOutput);
                    if (result.aborted) {
                        console.log(chalk_1.default.yellow("\n(task was aborted)"));
                    }
                    return [3 /*break*/, 3];
                case 2:
                    err_3 = _b.sent();
                    console.error(chalk_1.default.red("\u2716 ".concat(err_3.message)));
                    process.exitCode = 1;
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    }); });
}
