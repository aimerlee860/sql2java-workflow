# Project Spec — test-gen 子阶段（DDD：Processor 单元测试）

> 本规约由引擎注入 translate-test 子 agent 系统提示词（DDD 架构）。**仅对实现层角色类
> （架构模型段 `implRole` = processor，`{Proc}Processor.java`）生成单元测试**（Mockito），
> 不生成 Mapper 集成测试。

## 一、核心原则

- **清单驱动**：engine 派发前已确定性枚举 `testCases[]`（从 PL/SQL 结构抽 IF/ELSIF 分支、RAISE_APPLICATION_ERROR、FOR/WHILE 循环、DEFAULT NULL 参数）并注入 workOrder。**按清单逐条填 @Test，不自行发明用例**。实际覆盖率交 verify 阶段 JaCoCo 门禁兜底。
- **万物皆可 Mock**：任何依赖、方法、异常都可 Mock。一个测试函数一个断言即可，简单断言最好（`assertNotNull(response)`）。

## 二、测试文件位置与命名

- 目录与类名按架构模型段实现层角色（processor）的 `testDir`/`testSuffix`：`{projectRoot}/src/test/java/com/example/mfgerp/{module}/processor/` + `{className}ProcessorTest`。
- `className` 查 `scaffold.json.generated.procClassNames`（如 `GetTrdDtl` → `GetTrdDtlProcessorTest`）。
- **只生成 ProcessorTest，不生成 MapperIntegrationTest**。

## 三、测试壳（engine 确定性预生成，勿重写整文件）

engine 派发前已由 `test-scaffold-builder` 解析 `{className}Processor.java` 的注入依赖字段（DDD `@Autowired` 字段 + 构造器 final 字段），确定性生成 Mockito 壳并落盘 `{className}ProcessorTest.java`：

```java
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class XxxProcessorTest {
    @Mock private XxxAggregate xxxAggregate;   // Processor 的每个依赖一个 @Mock
    @Mock private XxxMapper xxxMapper;
    @InjectMocks private XxxProcessor processor;

    // @TEST_METHODS_HERE  ← 把本标记替换为 @Test 方法体，勿重写整文件、勿改 @Mock/@InjectMocks
}
```

- 你的工作：用 `edit` 把 `// @TEST_METHODS_HERE` 标记替换为 @Test 方法体。**不得重写整文件、不得改 @Mock/@InjectMocks 声明**。
- 若壳的 @Mock 列表不全（漏了 Processor 的某个依赖），用 `edit` 补对应 `@Mock` 字段。
- 若 import 缺失（壳里有 `// TODO: 补 import` 注释），补上对应 import。
- 若壳未生成（Processor 未落盘等降级情形），自行创建完整测试类。

## 四、Mock 策略

- 所有外部依赖必须 Mock：Aggregate（业务逻辑）、Mapper（数据库）、OutService（跨包调用）、任何可能抛异常的对象。
- 返回空值触发空指针保护、返回单值触发正常流程、返回多值触发循环、`thenThrow` 触发 catch 分支、多次调用 `thenReturn(...).thenReturn(...).thenThrow(...)` 返回不同值。
- `thenThrow` 用 `TranFailException`（DDD 业务异常）或普通异常（`RuntimeException`/`IllegalArgumentException`），**禁止** `OutOfMemoryError`/`StackOverflowError`。

## 五、按清单填 @Test

每条 `testCase` = 一个 @Test 方法，按字段填：

| 清单字段 | 填法 |
|---|---|
| `caseId` | 方法名后缀，如 `test_case_1_raise_20001` |
| `type=positive` | mock 使分支条件成立，`assertNotNull`/返回值断言 |
| `type=negative` | mock 使校验失败触达 RAISE；`expectKind=throws-TranFailException:<code>`（异常基类取架构模型段 `exception.baseClass`）→ `assertThrows(TranFailException.class, ...)` + 错误码断言 |
| `type=boundary` | 循环：mock 返回空集/单条/满集；DEFAULT NULL：传 null 触发 NVL 分支 |
| `setupHint` | mock 配置指引（参考，可细化） |
| `plsqlLine` | 注释标明覆盖的 PL/SQL 行 |

```java
@Test
void test_case_2_negative_raise_20001() {
    // L47 RAISE_APPLICATION_ERROR(-20001,'参数为空')
    when(aggregate.validate(any())).thenThrow(new TranFailException("参数为空"));
    Map<String,Object> r = processor.execute(req);
    assertEquals("1", r.get("oiFlag"));   // Processor 捕获异常后置 oiFlag=1
}
```

> DDD 下 RAISE_APPLICATION_ERROR 的负向用例：Aggregate/Validator 抛 `TranFailException`，Processor 捕获后置 `oiFlag="1"`/`procStat="0"`——断言 Processor 的错误响应而非直接 assertThrows（Processor 不外抛）。仅当直接测 Aggregate/Validator 方法时才用 `assertThrows(TranFailException.class, ...)`。

## 六、单函数多覆盖（清单条目多时首选）

清单条目多（超长过程）时，**在一个测试函数中覆盖连续多条同段用例**——复用 Mock，每次调用只改关键参数覆盖不同分支，减少方法数。适用：连续 if/else-if、switch/case、同逻辑不同参数组合。不适用：异常处理分支（建议单独测试）。

## 七、反射（私有方法/字段）

```java
import org.powermock.reflect.Whitebox;
String r = (String) Whitebox.invokeMethod(processor, "privateMethod", data);
Whitebox.setInternalState(processor, "initialized", true);
```

## 八、断言要求

最低：每个测试至少一个断言。`assertNotNull(response)` / `assertDoesNotThrow(...)` / `assertThrows(...)` + 错误码。

## 九、常见问题

- **Mockito 严格模式报错**：壳已加 `@MockitoSettings(strictness = Strictness.LENIENT)`。
- **参数匹配器错误**：禁混用匹配器与具体值——全用匹配器 `when(mapper.select(eq("id"), anyString()))` ✅。
- **NPE**：检查每个 @Mock 配置、@InjectMocks 注入关系。
- JUnit 5 `Assertions`，禁止 JUnit 4 `Assert`；**禁止 `@SpringBootTest`**。

## 十、检查清单

- [ ] 只产 `{className}ProcessorTest`，无 MapperIntegrationTest
- [ ] 按注入 `testCases[]` 清单逐条填 @Test，未自发明用例
- [ ] 用 `edit` 替换 `// @TEST_METHODS_HERE` 标记，未重写整文件、未改 @Mock/@InjectMocks（漏的 @Mock 已补）
- [ ] negative 用例断言 TranFailException（直接测 Aggregate/Validator 时 assertThrows；测 Processor 时断言错误响应 oiFlag/procStat）
- [ ] 所有测试可编译、可运行
- [ ] 未改翻译产物（只读 Java，写测试）；未改已有测试
