# Project Spec — translate-core 子阶段（DDD：TODO 桩 → 真实翻译）

> 本规约由引擎注入 translate-core 子 agent 系统提示词（DDD 架构）。严格对应 skeleton 留下的
> `// TODO:` 桩翻译——把 PL/SQL 逻辑落到 DDD 分层（Access/Processor/Aggregate/Builder/Validator/Mapper）。
> 不确定项由 LLM 给出最佳翻译，**不留 TODO**；真正无法确定的写中文注释说明，交 review/fix。

## 一、核心目标

严格对应 skeleton 留下的 `// TODO:` 桩翻译——**翻译一段删除该段 TODO 标记**。不确定项由 LLM 给出最佳翻译，**不留 TODO**；真正无法确定的写中文注释说明，交 review/fix。

### 1.1 多段切分：每次只填一段（>500 行过程）

超长过程 skeleton 已预切多段（见 skeleton §6.1），engine 每次 dispatch 注入**本派发目标段**（`segId` + PL/SQL 行范围 + 摘要）：

- **只替换对应 `// TODO:[seg-N]` 块**为真实实现，**保留其它 `// TODO:[seg-*]` 段不动**。
- 填完一段后回写 sidecar `translations/{pkg}/{ref}.segments.json` 的 `segments[]`：把该 `segId` 的 `status` 设为 `"done"`（read-modify-write，勿动其它字段）。
- **硬约束：只用方法头已声明的过程级局部变量**，不得新增过程级变量（段内局部变量除外）。
- **未注入目标段**（`segments[]` 缺失/空）→ 回退原行为：一次性填完文件内所有 `// TODO:` 桩。

### 1.2 单段过程

`segments[]` 仅 1 段时：一次填完该 `// TODO:[seg-1]` 桩，回写 status=done。

## 二、DDD 分层落位（核心）

PL/SQL 逻辑按 DDD 层职责拆落（角色 dir/suffix 按架构模型段）：

| PL/SQL 元素 | DDD 层 | 说明 |
|---|---|---|
| 存储过程入口/参数接收 | AccessImpl（+ AccessIntf 接口） | Map↔Bean 适配，委托 Builder 转换，不含业务逻辑 |
| 主流程编排 | Processor | 按原 PL/SQL 调用顺序编排 Aggregate/OutService，只做调用+异常捕获+状态流转，**不含业务判断** |
| 核心业务逻辑 | Aggregate | 业务方法 `throws TranFailException`，编排 Builder+Validator+Mapper |
| 变量声明/初始化/默认值 | Builder | `buildXxxParams()`/`initXxx()`/`buildOutputParams()` |
| IF-THEN-ELSE 校验 | Validator | `validate()`/`processResult()`，`throws TranFailException` |
| 跨包/跨 schema 调用 | OutService | 外部服务接口，不得在 Aggregate 直引他包 Mapper |
| DML/查询/存储过程调用 | Mapper + XML | per-proc Mapper |

- 步骤单一的主存储过程保持 Aggregate 单方法、Processor 单次调用，不强拆。拆分依据是原 SP 的调用结构（调用语句边界），属忠实呈现而非重构。

## 三、实体（Bean）对象设计

| 类型 | 识别特征 | 处理 |
|---|---|---|
| 自定义 Bean | 联表 JOIN 查询 或 计算字段（如 `amount * rate`） | 个性化设计：业务前缀（`{业务前缀}{功能}Bean`）+ `resultMap` 映射驼峰↔下划线；计算字段用 SQL `AS 别名` + resultMap 映射 |
| 标准 Bean | 单表查询（`SELECT *` 或部分字段），无联表无计算 | 复用 scaffold 全局 Bean（DDL 字段固定，Java 中只用需要的字段即可，无需新建） |

- Bean 字段必须与 inventory/schema 一致，**禁止编造**；发现不一致立即修复或标 TODO。
- **禁止为图新程序方便而修改已有 Bean**——新程序通过新 DTO 或 Map 适配。

## 四、Mapper XML 规范

1. **禁止 `SELECT *`**——必须明确列出所有字段。
2. **表名用 `schema.tableName`** 格式（schema 取自 workOrder「本 unit 涉及表的 schema 归属」块——引擎据 inventory DDL 归属注入本 unit source.sql 命中表；禁凭空猜测。已在 source.sql 带 schema 的保持原样，勿重复加前缀；未列入该块的表/synonym 无法确定归属，保留原样并在 notes 注明）。
3. **比较符号 XML 转义或 CDATA**：`<`→`&lt;`（或 `<![CDATA[<]]>`）、`>`→`&gt;` 等。
4. **占位符用 `#{}`**（禁 `${}`），namespace 对应 Mapper 接口全限定名。
5. **禁止 Mapper XML 调用存储过程**（去存储过程化目标）：XML 只查原始字段；存储过程调用改为 Java 层调已转换的 Access/OutService 方法，结果 set 回 Bean。
6. **SQL 与函数定义一致**：Mapper XML 中 SQL 必须与 `shard-inputs/{pkg}/{ref}/source.sql` 函数定义逐行一致，禁私自优化/简化/改写。

## 五、序列号处理

| 场景 | 处理 |
|---|---|
| INSERT | VALUES 中直接用 `seq_xxx.NEXTVAL` |
| SELECT 查序列 | 单独 `selectNextval()` 方法查询，禁在业务查询 SQL 中直接 NEXTVAL；GaussDB 虚拟表写 `SELECT seq_xxx.NEXTVAL FROM sys_dummy` |

## 六、BigDecimal 除法（硬规则）

- 所有 `BigDecimal.divide()` **必须指定舍入模式与精度**：`divide(divisor, 10, RoundingMode.DOWN)`（截断，保留 10 位小数）。
- ❌ 禁止无舍入模式除法（`ArithmeticException` 风险）。适用所有除法（金额计算、汇率换算、比例计算）。

## 七、异常处理（DDD 模型，硬规则）

1. **Aggregate/Validator/Builder 业务方法声明 `throws TranFailException`**——DDD 统一异常类型，禁 `new RuntimeException()`/`Exception`/`Throwable`。
2. **Processor 方法不标 `throws`**：内部 try-catch 自处理——catch 中 `CommonLog.error(msg, e)` 记录完整堆栈 + 设置 `bean.setProcStat("0")` + `bean.setExpInfo(...)`（异常信息 >1000 字符截断），**不外抛**。
3. **校验失败**：Validator 内 `bean.setProcStat("0")` + `bean.setExpInfo(...)` 后 `throw new TranFailException(msg)`。
4. **SELECT INTO 空值 + `EXCEPTION WHEN no_data_found`**：Java 中判空后抛 `TranFailException`（DDD 无 Validate.notNull 特例，统一 TranFailException）。
5. **异常信息长度超 1000 字符必须截断**，避免数据库字段溢出。
6. **日志统一用 `CommonLog`**（`CommonLog.info(...)`/`CommonLog.error(msg, e)`），禁 Log4j/Logback API、禁手写 LoggerFactory、禁静态自定义日志门面。

```java
// Processor：捕获异常、记日志、更新状态、不外抛
public Map<String,Object> addFmbmTrade(FmbmBean bean) {
    Map<String,Object> result = new HashMap<>();
    try {
        fmbmAggregate.comparePreApprove(bean);
        fmbmAggregate.addTrade(bean);
        result.put("oiFlag", "0");
    } catch (Exception e) {
        CommonLog.error("期权交易新增异常：" + e.getMessage(), e);
        bean.setExpInfo(e.getMessage().length() > 1000 ? e.getMessage().substring(0, 1000) : e.getMessage());
        bean.setProcStat("0");
        result.put("oiFlag", "1");
    }
    return result;
}
```

## 八、事务与依赖注入（DDD 模型）

- **事务**：涉及数据修改的 Aggregate 方法标注 `@Transactional(rollbackFor = Exception.class)`；Processor/AccessImpl 不标事务，由 Aggregate 控制事务边界。
- **依赖注入**：DDD 用 `@Autowired` 字段注入（Aggregate 持有 Builder/Validator/Mapper 引用，Processor 持有 Aggregate，AccessImpl 持有 Processor/Builder）。聚合根实现 `Serializable` + `serialVersionUID`。

## 九、函数调用失败处理

- **严格对照 SQL 定义文件实际行为**：若 SQL 中某函数调用失败后**没有 RETURN 结束函数**，Java 中**绝对不可**擅自加 `return` 提前返回。
- 调用失败后 SQL 若继续执行后续逻辑，Java 也必须继续；唯一例外是 SQL 明确用 RETURN 结束。

## 十、变量来源

- 未识别变量（常量/配置值）：查包头/SQL 目录声明，**禁止凭经验硬编码编造**。
- 非局部变量声明在主函数顶层，作用域覆盖整个主函数。
- **包级常量/变量复用 holder（强制）**：本包常量/变量引用 `{Pkg}Constant`/`{Pkg}StateDTO`（路径见「本 unit 派生值与路径规则」块）；**跨包**常量/变量引用见「依赖签名」块的「跨包常量/变量引用」段。常量 `static final` 直引、变量经 `{Pkg}StateDTO` bean getter/setter。**禁止重声明、禁止硬编码值**。
- 其它跨包变量（`{schema}.{变量名}`）查依赖签名块/上游 artifact 推导来源。

## 十一、翻译忠实度

- 严格匹配 SQL 原始逻辑：`nvl(a,b)`→`a != null ? a : b`、`nvl2(a,b,c)`→`a != null ? b : c`、`decode(a,v1,r1,v2,r2,default)`→`switch/if-else`；分支条件/循环边界/赋值顺序保持一致。
- **复用节点调用标注**：调用跨包/已转方法处加注释 `// ★ 复用节点调用：{子函数名}（原始 SQL 行号：XX）`。
- `if-else-if` 必须形成连续链式结构，不可拆分。不随意加 `LIMIT 1`（除非原 SQL 已有一行限制）。分立 SELECT 保持独立调用；游标循环用 for-each。

## 十二、自检清单

- [ ] 被填段无 `// TODO:` 残留；**未填段保留其 `// TODO:[seg-*]` 不动**
- [ ] 多段切分时已回写 sidecar `segments[].status="done"`；只用方法头已声明的过程级局部变量
- [ ] DDD 分层落位正确：编排进 Processor、业务进 Aggregate、校验进 Validator、构建进 Builder、跨包进 OutService
- [ ] Bean 分类正确，字段与 inventory 一致，未编造
- [ ] Mapper XML 无 `SELECT *`、表名带 schema、比较符号已转义或 CDATA、未调存储过程、SQL 与 source.sql 逐行一致
- [ ] 所有 BigDecimal 除法带 `(, 10, RoundingMode.DOWN)`
- [ ] Aggregate/Validator/Builder 方法 `throws TranFailException`；Processor try-catch 自处理不外抛、设 procStat/expInfo（>1000 截断）
- [ ] 日志用 `CommonLog`，无 Log4j/LoggerFactory
- [ ] Aggregate DML 方法标 `@Transactional(rollbackFor=Exception.class)`；依赖用 `@Autowired` 字段注入
- [ ] 序列号 SELECT 用单独方法（GaussDB `FROM sys_dummy`）
- [ ] 未擅自加提前 return（对照 SQL）；未识别变量已查来源
- [ ] 翻译忠实 SQL（nvl/decode/分支/循环），if-else-if 链式
