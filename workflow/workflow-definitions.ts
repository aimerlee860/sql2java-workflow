/**
 * Workflow Definitions & Artifact Schemas
 *
 * Level 1: 项目级工作流 (inventory → analyze → plan → scaffold)
 * Level 2: Package 翻译工作流 (parse → translate → review → verify + fix loop)
 */

import { z } from "zod"
import type { WorkflowDefinition } from "./engine-core"

// ============================================================================
// Oracle → Java 类型映射
// ============================================================================

export const ORACLE_TO_JAVA: Record<string, string> = {
  VARCHAR2: "String",
  NVARCHAR2: "String",
  CHAR: "String",
  NCHAR: "String",
  NUMBER: "BigDecimal",
  INTEGER: "Integer",
  BINARY_INTEGER: "Integer",
  PLS_INTEGER: "Integer",
  DATE: "LocalDate",
  TIMESTAMP: "LocalDateTime",
  "TIMESTAMP(6)": "LocalDateTime",
  "TIMESTAMP WITH TIME ZONE": "OffsetDateTime",
  CLOB: "String",
  BLOB: "byte[]",
  RAW: "byte[]",
  LONG: "String",
  BOOLEAN: "Boolean",
  SYS_REFCURSOR: "List<Map<String,Object>>",
}

export const ORACLE_TO_JDBC: Record<string, string> = {
  VARCHAR2: "VARCHAR",
  NVARCHAR2: "VARCHAR",
  NUMBER: "NUMERIC",
  INTEGER: "INTEGER",
  DATE: "DATE",
  TIMESTAMP: "TIMESTAMP",
  CLOB: "CLOB",
  BLOB: "BLOB",
}

// ============================================================================
// Level 1 Schemas: 项目级产物
// ============================================================================

const paramSchema = z.object({
  name: z.string(),
  oracleType: z.string(),
  direction: z.enum(["IN", "OUT", "INOUT"]),
})

const columnSchema = z.object({
  name: z.string(),
  oracleType: z.string(),
  nullable: z.boolean(),
  defaultValue: z.string().optional(),
})

export const inventorySchema = z.object({
  packages: z.array(z.object({
    name: z.string(),
    specFile: z.string(),
    bodyFile: z.string(),
    procedures: z.array(z.object({
      name: z.string(),
      type: z.enum(["procedure", "function"]),
      params: z.array(paramSchema),
      returnType: z.string().optional(),
      lineRange: z.tuple([z.number(), z.number()]),
      loc: z.number(),
    })),
    types: z.array(z.object({
      name: z.string(),
      kind: z.enum(["RECORD", "TABLE", "REF CURSOR", "SUBTYPE"]),
      definition: z.string(),
    })),
    variables: z.array(z.object({
      name: z.string(),
      type: z.string(),
      defaultValue: z.string().optional(),
    })),
    constants: z.array(z.object({
      name: z.string(),
      type: z.string(),
      value: z.string(),
    })),
  })),
  tables: z.array(z.object({
    name: z.string(),
    schema: z.string(),
    columns: z.array(columnSchema),
    primaryKey: z.array(z.string()),
  })),
  standaloneProcedures: z.array(z.object({
    name: z.string(),
    file: z.string(),
    params: z.array(paramSchema),
    loc: z.number(),
  })),
})

export const analysisSchema = z.object({
  callGraph: z.record(z.string(), z.array(z.string())),
  translationOrder: z.array(z.string()),
  complexity: z.record(z.string(), z.object({
    score: z.number(),
    patterns: z.array(z.string()),
    riskLevel: z.enum(["low", "medium", "high", "manual-required"]),
    manualReason: z.string().optional(),
  })),
  dialectFeatures: z.array(z.object({
    feature: z.string(),
    count: z.number(),
    affectedProcedures: z.array(z.string()),
  })),
  tableDependencies: z.record(z.string(), z.object({
    reads: z.array(z.string()),
    writes: z.array(z.string()),
  })),
})

export const planSchema = z.object({
  targetProject: z.object({
    groupId: z.string(),
    artifactId: z.string(),
    javaVersion: z.string(),
    springBootVersion: z.string(),
    mybatisType: z.enum([
      "mybatis-spring-boot-starter",
      "mybatis-plus-spring-boot-starter",
    ]),
    packageBase: z.string(),
  }),
  packageMappings: z.array(z.object({
    oraclePackage: z.string(),
    javaPackage: z.string(),
    mapperInterface: z.string(),
    serviceClass: z.string(),
    serviceImplClass: z.string(),
    dtoPackage: z.string(),
    batchSize: z.number(),
  })),
  rules: z.object({
    namingConvention: z.enum(["keep-oracle", "camelCase", "mixed"]),
    nullHandling: z.enum(["optional", "nullable", "throw-empty"]),
    exceptionStrategy: z.enum(["spring-data", "custom-business", "oracle-mirror"]),
    logFramework: z.enum(["slf4j", "log4j2"]),
    dbmsOutputMapping: z.enum(["log.info", "log.debug", "discard"]),
  }),
  manualReviewList: z.array(z.object({
    procedure: z.string(),
    reason: z.string(),
    suggestion: z.string().optional(),
  })),
})

export const scaffoldSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    description: z.string(),
  })),
  entities: z.array(z.object({
    tableName: z.string(),
    className: z.string(),
    packageName: z.string(),
    fields: z.array(z.object({
      fieldName: z.string(),
      javaType: z.string(),
      columnName: z.string(),
      oracleType: z.string(),
    })),
  })),
})

// ============================================================================
// Level 2 Schemas: 翻译级产物
// ============================================================================

/** PL/SQL 语句 IR — 递归 union，这里只做声明 */
const statementIR = z.object({
  _type: z.string(),
  line: z.number(),
})
// NOTE: 完整的递归 IR 太大，在实际 parse agent 的 prompt 中定义详细 schema。
// 这里只做骨架声明，实际校验在 agent 输出后做。

export const parsedPackageSchema = z.object({
  package: z.object({
    name: z.string(),
    sourceFile: z.string(),
  }),
  typeDefinitions: z.array(z.object({
    name: z.string(),
    kind: z.enum(["RECORD", "TABLE", "VARRAY", "REF CURSOR", "SUBTYPE"]),
    fields: z.array(z.object({
      name: z.string(),
      oracleType: z.string(),
      referencedTable: z.string().optional(),
      referencedColumn: z.string().optional(),
    })).optional(),
    sourceLine: z.number(),
  })),
  variables: z.array(z.object({
    name: z.string(),
    oracleType: z.string(),
    javaType: z.string(),
    defaultValue: z.string().optional(),
    isConstant: z.boolean(),
    sourceLine: z.number(),
  })),
  routines: z.array(z.object({
    name: z.string(),
    kind: z.enum(["procedure", "function"]),
    returnType: z.string().optional(),
    params: z.array(z.object({
      name: z.string(),
      oracleType: z.string(),
      javaType: z.string(),
      jdbcType: z.string(),
      direction: z.enum(["IN", "OUT", "INOUT"]),
    })),
    sourceLines: z.tuple([z.number(), z.number()]),
    body: z.array(statementIR),
    summary: z.object({
      totalStatements: z.number(),
      hasCursors: z.boolean(),
      hasBulkCollect: z.boolean(),
      hasDynamicSQL: z.boolean(),
      hasAutonomousTransaction: z.boolean(),
      callsPackages: z.array(z.string()),
      unknownCount: z.number(),
      warnings: z.array(z.string()),
    }),
  })),
})

export const translationOutputSchema = z.object({
  packageName: z.string(),
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
    role: z.enum([
      "mapper-interface",
      "mapper-xml",
      "service",
      "service-impl",
      "dto",
      "exception",
    ]),
    correspondingProcedure: z.string().optional(),
  })),
  decisions: z.array(z.object({
    line: z.number(),
    oracleConstruct: z.string(),
    javaConstruct: z.string(),
    reason: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
  })),
  todos: z.array(z.object({
    file: z.string(),
    lineInJava: z.number(),
    issue: z.string(),
    oracleLine: z.number(),
    suggestion: z.string(),
  })),
  manualRequired: z.array(z.object({
    procedure: z.string(),
    reason: z.string(),
  })).optional(),
})

export const reviewSchema = z.object({
  passed: z.boolean(),
  overallScore: z.number(),
  procedureReviews: z.array(z.object({
    procedure: z.string(),
    checks: z.array(z.object({
      category: z.enum([
        "logic-equivalence",
        "sql-equivalence",
        "null-handling",
        "type-mapping",
        "exception-mapping",
        "transaction-boundary",
        "cursor-mapping",
        "parameter-direction",
        "variable-scope",
        "line-reference",
        "naming-consistency",
        "mapper-id-match",
      ]),
      passed: z.boolean(),
      detail: z.string(),
      severity: z.enum(["critical", "warning", "info"]),
    })),
  })),
  mustFix: z.array(z.object({
    file: z.string(),
    line: z.number().optional(),
    issue: z.string(),
    oracleLine: z.number().optional(),
  })),
  suggestions: z.array(z.string()),
})

export const verifySchema = z.object({
  passed: z.boolean(),
  compilation: z.object({
    success: z.boolean(),
    errors: z.array(z.object({
      file: z.string(),
      line: z.number(),
      message: z.string(),
    })).optional(),
  }),
  testGeneration: z.object({
    generated: z.boolean(),
    testFile: z.string().optional(),
    testCases: z.number().optional(),
  }),
  mybatisValidation: z.object({
    mapperXmlValid: z.boolean(),
    statementIdsMatch: z.boolean(),
    parameterMapsValid: z.boolean(),
    resultMapsValid: z.boolean(),
  }),
})

// ============================================================================
// Level 1: Project Workflow Definition
// ============================================================================

export const projectWorkflow: WorkflowDefinition = {
  id: "oracle-to-mybatis-project",
  description: "扫描 Oracle PL/SQL 项目，规划并生成 Spring Boot + MyBatis 项目骨架",
  phases: [
    {
      name: "inventory",
      agent: "sql-analyst",
      description: "扫描 PL/SQL 源码目录，编目所有 Package、Procedure、Function、Type、Table",
      temperature: 0.1,
      maxRetries: 2,
      failureBranch: "debug",
    },
    {
      name: "analyze",
      agent: "sql-analyst",
      description: "构建调用依赖图，分析复杂度，识别 Oracle 方言特性，拓扑排序确定翻译顺序",
      temperature: 0.1,
      maxRetries: 2,
      failureBranch: "debug",
    },
    {
      name: "plan",
      agent: "java-architect",
      description: "规划 Java 项目架构、包结构、翻译批次、映射规则",
      temperature: 0.2,
      maxRetries: 1,
      failureBranch: "debug",
      requireApproval: true,
    },
    {
      name: "scaffold",
      agent: "java-architect",
      description: "生成 Spring Boot 项目骨架、Entity、Mapper 空壳、配置文件",
      temperature: 0.2,
      maxRetries: 1,
    },
    {
      name: "debug",
      agent: "debugger",
      description: "诊断失败原因",
      temperature: 0.1,
      maxRetries: 0,
    },
  ],
  transitions: {
    inventory: ["analyze"],
    analyze: ["plan"],
    plan: ["scaffold"],
    scaffold: [],
    debug: [],
  },
}

// ============================================================================
// Level 2: Package Translation Workflow Definition
// ============================================================================

export const translationWorkflow: WorkflowDefinition = {
  id: "oracle-package-translation",
  description: "将单个 Oracle Package 翻译为 Spring Boot + MyBatis 代码",
  phases: [
    {
      name: "parse",
      agent: "sql-parser",
      description: "将 Package 的 PL/SQL 解析为结构化 IR（中间表示）",
      temperature: 0.0,
      maxRetries: 2,
      failureBranch: "debug",
    },
    {
      name: "translate",
      agent: "translator",
      description: "基于 IR 生成 Mapper 接口 + Mapper XML + Service 实现 + DTO",
      temperature: 0.1,
      maxRetries: 3,
      failureBranch: "debug",
    },
    {
      name: "review",
      agent: "java-reviewer",
      description: "审查翻译等价性：逻辑、SQL、异常、类型、命名",
      temperature: 0.1,
      maxRetries: 1,
    },
    {
      name: "verify",
      agent: "test-generator",
      description: "编译检查 + MyBatis XML 校验 + 生成对比测试",
      temperature: 0.1,
      maxRetries: 2,
      failureBranch: "fix",
    },
    {
      name: "fix",
      agent: "translator",
      description: "根据 review/verify 反馈修复翻译问题",
      temperature: 0.1,
      maxRetries: 3,
    },
    {
      name: "debug",
      agent: "debugger",
      description: "输出无法自动翻译的诊断报告",
      temperature: 0.1,
      maxRetries: 0,
    },
  ],
  transitions: {
    parse: ["translate"],
    translate: ["review"],
    review: {
      _condition: "artifact.passed",
      true: ["verify"],
      false: ["fix"],
    },
    verify: {
      _condition: "artifact.passed",
      true: [],
      false: ["fix"],
    },
    fix: ["review"],
    debug: [],
  },
}

// ============================================================================
// Progress Tracking
// ============================================================================

export interface TranslationProgress {
  totalPackages: number
  completedPackages: string[]
  inProgressPackages: string[]
  failedPackages: Array<{ name: string; reason: string }>
  manualRequired: string[]
  totalProcedures: number
  translatedProcedures: number
  lastUpdated: string
}

export function createProgress(totalPackages: number, totalProcedures: number): TranslationProgress {
  return {
    totalPackages,
    completedPackages: [],
    inProgressPackages: [],
    failedPackages: [],
    manualRequired: [],
    totalProcedures,
    translatedProcedures: 0,
    lastUpdated: new Date().toISOString(),
  }
}
