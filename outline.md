# f_format_amount 存储过程转Java大纲

## 一、概述

### 1.1 存储过程功能

**函数名称**：f_format_amount

**主要功能**：根据币种进行金额格式化

**处理逻辑**：
- 根据传入的币种参数获取小数位数和取舍方式
- 根据千分位标志位决定是否进行千分位处理
- Y：进行千分位处理，N：不进行千分位处理
- 取舍方式：R-四舍五入，T-直接舍去
- 返回格式化后的金额字符串

### 1.2 转换策略

1. **服务映射**：f_format_amount → FFormatAmount（方法名保持不变）
2. **参数封装**：该函数有3个入参，未超过5个，暂不封装为DTO，直接使用独立参数
3. **返回类型**：VARCHAR2 → String
4. **子函数调用**：
   - f_get_decimal_rtype：获取小数位数和取舍方式，已在db2java.md中记录
   - f_num_to_deci_rtype2：无千分位格式化，已在db2java.md中记录
   - f_num_to_deci：有千分位格式化，已在db2java.md中记录
5. **设计模式**：采用工具类设计，将功能封装在CurrencyFormatUtil工具类中
6. **异常处理**：捕获所有异常，返回原始金额的字符串形式

## 二、实体类设计

### 2.1 DO类（映射数据库表）

**检索结果**：根据table2do.md，ref_currinfo_t表用于查询币种的小数位数和取舍方式，该表主要用于查询，不需要创建专门的DO类，可使用Map或简单DTO传递查询结果。

### 2.2 DTO 类（入参封装）

**检索结果**：当前函数入参3个（in_amount、is_ccy、is_flag），未超过5个，暂不封装DTO。但如果后续有类似功能扩展，可考虑封装。

**建议DTO（可选，供未来扩展使用）**：
- **FormatAmountDTO**：金额格式化入参
  - amount: Number（金额）
  - ccy: String（币种简称或ID）
  - flag: String（千分位标志位，Y/N）

### 2.3 Result 类（出参封装）

**检索结果**：该函数返回单一String类型结果，无需封装Result类。

**返回说明**：
- 格式化后的金额字符串

## 三、子函数调用

### 检索结果

根据db2java.md文档，检索到以下子函数对应的Java方法：

1. **f_get_decimal_rtype** → `com.icbc.gmo.app.CurrInfoService.fGetDecimalRtype(FGetDecimalRtypeParam param)`
   - 功能：获取币种的小数位数和取舍方式
   - 入参：币种简称或ID
   - 出参：小数位数（Number）、取舍方式（String）

2. **f_num_to_deci_rtype2** → `com.icbc.gmo.common.utils.NumberFormatUtil.fNumToDeciRtype2(NumToDeciParam param)`
   - 功能：无千分位的金额格式化
   - 入参：数值、小数位数、取舍方式
   - 出参：格式化后的字符串

3. **f_num_to_deci** → `com.icbc.gmo.common.utils.NumberFormatUtil.fNumToDeci(NumToDeciParam param)`
   - 功能：有千分位的金额格式化
   - 入参：数值、小数位数
   - 出参：格式化后的字符串

**结论**：所有子函数均已转换为Java方法，可直接调用。

## 四、业务逻辑

### 4.1 业务逻辑方法

#### 方法定义

**方法名**：fformatAmount

**出参**：String（格式化后的金额字符串）

**入参**：
- amount: Number（金额）
- ccy: String（币种简称或ID）
- flag: String（千分位标志位，Y/N）

**功能描述**：根据币种和标志位对金额进行格式化

#### 逻辑处理

**执行顺序**：

1. **参数校验**（可选）
   - 校验amount是否为null
   - 校验ccy是否为null或空

2. **获取小数位数和取舍方式**
   - 调用 `CurrInfoService.fGetDecimalRtype()` 获取小数位数（vi_decimal）和取舍方式（vi_rounding_type）
   - 该方法内部已处理异常，默认返回2位小数和'R'取舍方式

3. **判断千分位标志位**
   - **如果flag为'N'或'n'**：
     - 调用 `NumberFormatUtil.fNumToDeciRtype2()` 进行无千分位格式化
     - 传入参数：金额、小数位数、取舍方式

   - **否则（flag为'Y'或其他值）**：
     - 调用 `NumberFormatUtil.fNumToDeci()` 进行有千分位格式化
     - 传入参数：金额、小数位数

4. **返回结果**
   - 对格式化结果进行trim操作
   - 返回trim后的字符串

**分支判断**：
- 分支1：flag = 'N' 或 flag = 'n' → 无千分位格式化
- 分支2：其他情况 → 有千分位格式化

**异常处理**：
- 捕获所有异常
- 异常时返回原始金额的字符串形式：`to_char(in_amount)` → `String.valueOf(amount)`
- 记录异常日志（log.error）

#### 异常处理

1. **异常捕获**：使用try-catch捕获所有异常
2. **异常返回**：返回原始金额的字符串形式
3. **日志记录**：记录异常信息（如果需要）

#### 涉及新增或修改的类和方法

**新增类**：
1. **CurrencyFormatUtil**（工具类）
   - `fformatAmount(Number amount, String ccy, String flag)`：金额格式化主方法
   - 私有辅助方法（如有需要）

**修改类**：
- 无

**依赖的已有类**：
1. `com.icbc.gmo.app.CurrInfoService.fGetDecimalRtype()`
2. `com.icbc.gmo.common.utils.NumberFormatUtil.fNumToDeciRtype2()`
3. `com.icbc.gmo.common.utils.NumberFormatUtil.fNumToDeci()`

### 4.2 代码实现要点

1. **工具类设计**：
   - 使用static方法，便于调用
   - 遵循无状态设计原则
   - 方法添加Javadoc注释

2. **空值处理**：
   - 对flag参数进行大小写不敏感处理
   - 对返回结果进行trim操作

3. **日志规范**：
   - 使用SLF4J记录日志
   - 外部调用记录input/output日志（log.info）
   - 异常记录log.error

4. **编码规范**：
   - 方法名与原存储过程保持一致：fformatAmount
   - 参数名尽量与原存过保持一致
   - 使用 `{}` 占位符打印日志
