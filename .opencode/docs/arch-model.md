## 架构模型

> 本段是架构决策的唯一事实源，被 `@include` 内联进主规约后对所有写 Java 的 agent 可见，
> 同时由工作流引擎解析成 `ArchitectureModel` 供确定性 builder（DO/test-shell/verify/test-case 等）消费。
> 切换架构（如换 DDD）只需替换本段内容或 `@include` 另一个模型文件。
> `###` 子节标题为固定契约，正文用表格 + `- key: value` 列表。

### layout
flat-no-root

### packageBase
<!-- 无根包留空 -->

### 角色
| role | suffix | package | dir | testDir | testSuffix | xmlDir | implRole |
|---|---|---|---|---|---|---|---|
| service | Service | service | src/main/java/service | | | | |
| service-impl | ServiceImpl | service.impl | src/main/java/service/impl | src/test/java/service/impl | ServiceImplTest | | true |
| mapper | Mapper | mapper | src/main/java/mapper | | | src/main/resources/mapper | |

### 包级产物
| artifact | suffix | dir |
|---|---|---|
| constant | Constant | src/main/java/constant |
| stateDto | StateDTO | src/main/java/dto |

### 实体
- 后缀: DO
- 目录: src/main/java/entity
- 包: entity
- 注解: @Data, @TableName("{table}")
- imports: lombok.Data, com.baomidou.mybatisplus.annotation.TableName

### 异常
- 基类: BusinessException
- 包: exception
- 子类: DataNotFoundException, ValidationException

### 跨包调用
- FQN 模式: service.{className}Service

### 覆盖率排除
config/, entity/, exception/, util/, constant/, dto/

### 主类扫描包
config, service, service.impl, mapper, constant, dto, entity, exception, util
