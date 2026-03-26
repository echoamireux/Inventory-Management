# TSC + BarTender 扫码标签试运行实施说明

## 1. 交付内容

本试运行包包含以下 5 项内容：

1. 本说明文档
2. `扫码标签数据.xlsx` 标签台账模板
3. `膜材_100x50_横版.svg` 版式示意图
4. `化材标准瓶_100x30_横版.svg` 版式示意图
5. `化材小瓶_100x30_极简裁切版.svg` 版式示意图

本轮目标是先把扫码标签体系跑通，不等待定制规格，不追求一次定型。

---

## 2. 试运行收口原则

- 直接使用现场已有 `100 x 50 mm` 和 `100 x 30 mm` 耗材。
- 第一轮不做 BarTender 单模板多版式切换，统一使用 3 个独立模板。
- 二维码统一采用 `QR Code`。
- 二维码内容统一固定为标签编号 `unique_code`，例如 `L000123`。
- 微信普通扫一扫和小程序扫码读到的都是同一个标签编号。
- 标签只放静态识别信息，不放当前库存、不放当前库位、不放动态临期状态。
- 标签功能定位为库存运营标签，不替代原厂标签、GHS 标签和危险化学品主标签。

---

## 3. 三类标签模板

### 3.1 膜材模板

- 模板名称：`膜材_100x50_横版`
- 纸张规格：`100 x 50 mm`
- 适用对象：膜材卷、卷芯、外包装、面积较大的贴标位置

左侧编码区：

- 二维码
- 二维码下方直接显示标签编号，例如 `L000123`
- 不再单独写“标签编号”标题

右侧信息区：

- 第一行最大主标题：产品代码
- 第二行：物料名称
- 其余信息使用短标题：
  - `子类`
  - `厚度`
  - `幅宽`
  - `批次`
  - `效期`

膜材字段固定为：

- `unique_code`
- `product_code`
- `material_name`
- `sub_category`
- `thickness_um`
- `width_mm`
- `batch_number`
- `expiry_date`

不放的字段：

- 当前剩余库存
- “扫码查看实际数量”
- 当前库位

### 3.2 化材标准瓶模板

- 模板名称：`化材标准瓶_100x30_横版`
- 纸张规格：`100 x 30 mm`
- 适用对象：500g 瓶、中瓶、大瓶、常规桶身空白区域

左侧编码区：

- 二维码
- 二维码下方直接显示标签编号

右侧信息区：

- 第一行最大主标题：产品代码
- 第二行：物料名称

化材标准瓶字段固定为：

- `unique_code`
- `product_code`
- `material_name`

### 3.3 化材小瓶模板

- 模板名称：`化材小瓶_100x30_极简裁切版`
- 纸张规格：`100 x 30 mm`
- 适用对象：很小的助剂瓶、分装瓶、最小单瓶

左侧编码区：

- 二维码
- 二维码下方直接显示标签编号

右侧信息区：

- 第一行最大主标题：产品代码

化材小瓶字段固定为：

- `unique_code`
- `product_code`

本模板允许打印后手工裁掉多余留白，再去现场试贴。

---

## 4. 标签数据模板说明

推荐使用本试运行包中的 `扫码标签数据.xlsx` 作为统一台账。

工作簿包含 3 个工作表：

1. `film_labels`
2. `chemical_std`
3. `chemical_mini`

每个工作表统一保留以下字段：

- `unique_code`
- `qr_text`
- `product_code`
- `material_name`
- `sub_category`
- `thickness_um`
- `width_mm`
- `batch_number`
- `expiry_date`
- `copies`
- `status`
- `note`

字段规则：

- `qr_text = unique_code`
- `unique_code` 永不复用
- `copies` 默认填 `1`
- `status` 建议只使用：
  - `unused`
  - `printed`
  - `used`
  - `void`
  - `reprint`

建议首轮标签号段按顺序发号，例如：

- `L000001 ~ L000300`

打印废弃号必须在台账中标记 `void`，不能贴到别的物料上。

---

## 5. BarTender 操作步骤

### 5.1 前置准备

1. 打开 `扫码标签数据.xlsx`
2. 在对应 sheet 中填入要打印的标签数据
3. 保证 `qr_text` 与 `unique_code` 完全一致
4. 保存并关闭 Excel，避免被占用

### 5.2 创建膜材模板 `膜材_100x50_横版`

1. 打开 BarTender，新建文档
2. 选择现场 TSC 打印机
3. 在页面设置中把标签尺寸设为 `100 mm x 50 mm`
4. 方向选择横向
5. 打开 `File > Database Connection Setup`
6. 连接 `扫码标签数据.xlsx`
7. 选择工作表 `film_labels`
8. 在左侧插入 `QR Code`
9. 将二维码数据源绑定到字段 `qr_text`
10. 关闭二维码自带的人眼可读字符显示
11. 在二维码下方插入文本对象，绑定 `unique_code`
12. 在右侧插入文本对象并绑定：
    - `product_code`
    - `material_name`
    - `sub_category`
    - `thickness_um`
    - `width_mm`
    - `batch_number`
    - `expiry_date`
13. 建议直接在文本对象中拼接最终显示形式：
    - `子类：{sub_category}`
    - `厚度：{thickness_um} μm`
    - `幅宽：{width_mm} mm`
    - `批次：{batch_number}`
    - `效期：{expiry_date}`
14. 将 `product_code` 设为最大字号主标题
15. 将 `material_name` 设为第二层字号
16. 将 `子类 / 厚度 / 幅宽 / 批次 / 效期` 设为较小正文
17. 打开 Print Preview，切换不同记录预览长名称、长批号和空子类别
18. 保存为 `膜材_100x50_横版.btw`

### 5.3 创建化材标准瓶模板 `化材标准瓶_100x30_横版`

1. 新建文档
2. 选择同一台 TSC 打印机
3. 页面设置改为 `100 mm x 30 mm`
4. 打开 `File > Database Connection Setup`
5. 连接 `扫码标签数据.xlsx`
6. 选择工作表 `chemical_std`
7. 左侧插入 `QR Code`，绑定 `qr_text`
8. 关闭二维码自带人眼字符
9. 在二维码下方插入文本对象，绑定 `unique_code`
10. 右侧放两个文本对象：
    - `product_code`
    - `material_name`
11. `product_code` 设为最大字号主标题
12. `material_name` 设为副标题
13. 不加其他字段，不加多余标题
14. 预览 500g 瓶对应标签，确认二维码与文字比例平衡
15. 保存为 `化材标准瓶_100x30_横版.btw`

### 5.4 创建化材小瓶模板 `化材小瓶_100x30_极简裁切版`

1. 新建文档
2. 标签尺寸仍设为 `100 mm x 30 mm`
3. 打开 `File > Database Connection Setup`
4. 连接 `扫码标签数据.xlsx`
5. 选择工作表 `chemical_mini`
6. 不使用整张标签宽度，只将有效内容区布置在中间区域
7. 左侧插入 `QR Code`，绑定 `qr_text`
8. 在二维码下方放置 `unique_code`
9. 右侧只保留 `product_code`
10. 不放 `material_name`
11. 保存为 `化材小瓶_100x30_极简裁切版.btw`
12. 第一轮打印后手工裁掉左右多余留白，再到小瓶上试贴

### 5.5 细化设置建议

- 二维码统一使用 `QR Code`
- 二维码遮罩 `Mask` 使用默认 `Auto`
- 二维码保持黑码白底
- 不在二维码中嵌 logo
- 保留二维码安静区，不让文字贴边
- 建议使用清晰无衬线字体，不用宋体
- 第一轮不做条件脚本，不做一个模板内切三种版式

---

## 6. 版式默认值

### 6.1 膜材 `100 x 50`

- 左侧编码区约占 `25%`
- 右侧信息区约占 `75%`
- `product_code` 为整张主视觉第一层
- `material_name` 为第二层
- `子类 / 厚度 / 幅宽 / 批次 / 效期` 为第三层
- 标签编号仅出现在二维码下方

### 6.2 化材标准瓶 `100 x 30`

- 左侧编码区约占 `30%`
- 右侧信息区约占 `70%`
- `product_code` 第一层
- `material_name` 第二层
- 标签编号仅放二维码下方

### 6.3 化材小瓶 `100 x 30`

- 有效内容区居中
- 优先保证二维码和标签编号清晰
- `product_code` 单独保留为右侧主标题
- 第一轮允许手工裁切

---

## 7. 现场试运行流程

1. 在 Excel 台账中生成本轮要打印的标签数据
2. 三类模板先各打印 `5~10` 张试样
3. 膜材贴卷材、卷芯或外包装空白位置
4. 化材标准瓶贴瓶身，不遮挡原化学标签和危险图示
5. 化材小瓶优先贴瓶身侧面，不以瓶盖作为主标签位
6. 打印后先用微信扫一扫，确认显示的是标签编号，例如 `L000123`
7. 再用小程序首页“智能扫码”测试是否进入正确的标签识别链路
8. 通过后再批量打印本轮正式号段
9. 现场损坏补打时，必须使用原 `unique_code` 重打，不换号

---

## 8. 验收与回归检查

### 膜材模板

- 打印 5 张，贴到 1 卷或 1 个卷芯位置
- 检查二维码是否稳定可扫
- 检查批次和效期是否能肉眼核对

### 化材标准瓶模板

- 打印 5 张，贴到 500g 瓶和中瓶
- 检查是否遮挡原标签关键区域
- 检查产品代码和名称是否足够清晰

### 化材小瓶模板

- 打印 5 张
- 手工裁切后贴到最小瓶
- 检查二维码是否仍能识别
- 检查产品代码是否仍可读

### 打印回归

- 长物料名称不能压到二维码区
- 膜材批号和效期不能重叠
- 裁切后不能破坏二维码安静区

### 材质试运行

- 膜材可先使用现有标签纸试运行
- 化材先做少量试贴
- 如果出现掉边、模糊、擦拭后失效，再切换合成耐化学标签

---

## 9. 官方参考链接

- BarTender 数据库连接  
  <https://help.seagullscientific.com/2021/en/subsystems/gsm/content/GS_User_Databases.htm>
- BarTender Database Connection Setup  
  <https://help.seagullscientific.com/10.1/en/content/HID_FILE_DATABASE_SETUP.htm>
- BarTender Barcode Object  
  <https://help.seagullscientific.com/2022/en/content/Objects_Barcode.htm>
- BarTender QR Code Mask  
  <https://help.seagullscientific.com/2019/en/content/Mask.htm>
- BarTender 人眼字符设置  
  <https://help.seagullscientific.com/10.1/en/Content/HumanReadable_Placement.htm>
- QR Code 版本与容量说明  
  <https://www.qrcode.com/en/about/version.html/>
- QR Code 安静区说明  
  <https://www.qrcode.com/zh/howto/code.html>
