# 工程经验记忆

本文件由本地工程智能体持续维护，并在每次任务开始时自动读取。它保存跨任务可复用的已验证经验，不保存普通聊天记录。

## 记录规则

- 当前项目事实必须来自工程文件、设备反馈、测试结果或用户确认。
- 外部经验优先引用制造商手册、数据表、发行说明和适用标准，记录链接、版本与访问日期。
- 未验证推测只能进入“待验证假设”，不能写入“已验证经验”。
- 新记录先查重；同类问题优先修订已有条目并补充适用版本。
- 设备型号、固件、软件版本、寄存器地址和接线条件不同，都必须重新核对。
- 不记录账号、密钥、令牌、个人信息或其他敏感数据。

## 经验条目字段

- 日期
- 工作目录或项目
- 专业领域
- 设备与版本
- 现象
- 已确认事实和证据
- 根因
- 处理方法
- 验证方法与结果
- 资料来源
- 适用范围与安全边界

## 已验证经验

### 2026-08-11｜C:\path｜PLC/CODESYS 椅子流程版本化、对象归属与模块化监视

- 日期：2026-08-11
- 工作目录或项目：`C:\path`；`FiveDofPlatform_v26084.project` → `FiveDofPlatform_v26086.project` → `FiveDofPlatform_v26087.project`；`v26085` 已撤回
- 专业领域：CODESYS、SoftMotion 流程调度、PLC/上位机接口契约
- 设备与版本：CODESYS V3.5 SP20 Patch 4；X/Y/Z/B 四轴流程，接口版本 26087
- 现象：原 `PLC_PRG` 已挂入 5 ms `MainTask` 但实现为空；第一次增量导入后，用户在 Application 项目树中看不到四个新增 POU；修正对象归属后仍需要中文注释、外部/现场/PLC 变量所有者标识、动作模块化和统一数据监视。
- 已确认事实和证据：`v26085` 的新增对象位于工程根目录且 Application 内仍是旧空 `PLC_PRG`；`v26086` 修正了对象归属；`v26087` 保留三功能动作顺序，把所有 XYZ、B 轴预定位/间距/复位目标标为外部写入，并加入公共轴运动 FB、公共反馈等待 FB、步骤/动作/轴掩码及目标/实际/误差监视量。独立重开后 7 个目标对象均唯一位于 `Device / Plc Logic / Application`。
- 根因：对 project 根对象执行 PLCopenXML 导入会把对象加入工程根目录；仅凭反向导出包含对象和 rebuild 成功，无法证明对象属于任务所用的 Application。流程步骤只保存在同名局部变量、磁铁/抱闸/气缸各自重复定时器时，也不利于统一监视和后续替换动作实现。
- 处理方法：从未修改的 `v26084` 派生独立版本，用 ScriptEngine 将目标对象移入 Application 并替换旧空 `PLC_PRG`；`v26087` 将三个业务功能保留为独立 POU，将轴运动和现场反馈等待抽成两个公共 FB，外部命令在序号变化时原子锁存，所有安全许可默认关闭，并把功能步骤、动作类型、轴掩码、目标、速度、实际位置和绝对误差镜像到只读诊断区。
- 验证方法与结果：全新进程重开对象树确认 7 个对象路径和唯一性；CODESYS rebuild 为 0 错误、12 条既有警告；反向导出的 6 个 POU 与增量源 ST 正文归一化一致，含 64 处程序注释和 72 处所有者/现场/监视标识；`MainTask` 仍调用 `LogConsumer, PLC_PRG, ModbusTcpSlave`；C 轴引用为 0、安全许可默认 TRUE 为 0；原九个核心 POU 与 v26084 的接口和 ST 正文哈希一致。
- 资料来源：`C:\path\流程图.pdf` 第 1 页；`C:\path\export\FiveDofPlatform_v26084.plcopenxml`；`C:\path\export\FiveDofPlatform_v26086.plcopenxml`；`C:\path\export\FiveDofPlatform_v26087.plcopenxml`；`C:\path\engineering\FiveDofPlatform_v26087.register-map.md`；CODESYS ScriptEngine 对象树结果；用户提供的轴机械参数和外部变量所有者确认。
- 适用范围与安全边界：CODESYS 增量导入后必须验证完整对象路径和任务绑定，不能只检查导出内容或编译结果。诊断变量是只读监视语义，尚无物理 Modbus 地址。当前只证明离线工程结构、编译和导出一致性；物理 IO/Modbus 地址、轴缩放、回零、限位、B 轴间距换算、机器人退出共享区、急停链和真正 `MC_Stop` 仍须现场验证，不得据此自动下载、启动 PLC 或写动作寄存器。

### 2026-08-11｜C:\path｜CODESYS 残留版本识别与项目文件关联隔离

- 日期：2026-08-11
- 工作目录或项目：`C:\path`；FiveDofPlatform 工程系列
- 专业领域：CODESYS 工程站、Windows Installer、项目文件关联
- 设备与版本：保留 CODESYS `3.5.20.40`（V3.5 SP20 Patch 4）；已清理残留产品登记 `3.5.22.20`（MSI ProductVersion `3.5.22.200`）
- 现象：Windows 卸载列表仍显示 `3.5.22.20`，其程序目录已不存在；双击 `.project` 由 CODESYS Installer 选择版本，可能造成版本选择异常。
- 已确认事实和证据：清理前 Windows Installer COM 返回 `3.5.22.20` 的 `ProductState=5`，说明不是单一卸载列表文本，而是 MSI 数据库仍判定产品已安装；缓存 MSI 的 ProductCode 为 `{C9E7CB02-C30C-4CD8-AB00-75E69082BB96}`，SHA256 为 `6B5D5C401587C3E96BCCD63BF35A19D4B8EDBA4ACFB48DBC801826B7D32F7A21`，CODESYS 官方数字签名有效。实际保留的可执行文件为 `3.5.20.40`。原 `.project` 机器级关联是 `projectfile_x64`，命令指向 `APInstaller.GUI.exe`。
- 根因：`3.5.22.20` 历次卸载以 `1603/1602` 失败，导致程序目录状态与 MSI 产品数据库不一致；独立安装的 CODESYS Installer 仍保留通用 `.project` 关联。
- 处理方法：先导出精确 MSI 产品键和原文件关联到 `C:\path\backups\codesys-registry-20260811`；不手删 MSI 数据库的部分键。使用当前用户级 ProgID `CODESYS.Project.3.5.20.40` 覆盖 `.project`，启动命令固定带 `--profile="CODESYS V3.5 SP20 Patch 4"` 和 `--project="%1"`。在管理员上下文且全部 CODESYS IDE 窗口关闭后，对精确 ProductCode 执行 Windows Installer 正规卸载，使用静默、禁自动重启和禁 Restart Manager 自动关应用参数；详细日志保存为 `06-msiexec-uninstall-3.5.22.20.log`。
- 验证方法与结果：MSI 日志记录 `Removal completed successfully`，客户端与服务端 `MainEngineThread` 均返回 `0`；卸载后 `ProductState=-1`，Uninstall、Installer Products、Installer UserData 三个精确产品键均不存在，卸载列表无同版本命中。Windows Shell `AssocQueryString` 的命令、可执行文件和文档类型仍解析到 `C:\Program Files\CODESYS 3.5.20.40\CODESYS\Common\CODESYS.exe`；该文件版本、官方签名和 SHA256 均保持不变。v26086/v26087 的 `.project`、PLCopenXML 和寄存器表六个文件哈希全部匹配卸载前基准。日志在卸载动作开始前检测到系统已有待重启标志，但当前待重命名条目中没有 CODESYS 相关路径，且本轮未自动重启。
- 资料来源：本机 Windows Installer COM/注册表、缓存 MSI 属性与数字签名、Windows Shell 关联查询 API、`C:\path\backups\codesys-registry-20260811\06-msiexec-uninstall-3.5.22.20.log`；访问日期 2026-08-11。
- 适用范围与安全边界：安装目录缺失但 MSI `ProductState=5` 时，不应只删除卸载列表或 Installer 产品键，否则可能破坏组件引用和后续修复。应先关闭并保存 IDE 工程，在管理员上下文中使用身份和签名已核验的缓存 MSI/精确 ProductCode 正规卸载，禁自动关应用和自动重启，并核对日志返回码、最终产品状态、保留版本及工程哈希。用户级文件关联只改变打开方式，不安装、卸载或修改 PLC 工程；回退时只删除该用户级 ProgID 和扩展名覆盖。缓存 MSI 是否删除由 Windows Installer 管理，不手工清理。

### 2026-08-11｜C:\Users\29925\Documents\temp｜AS5600 转向角度采集电路的跨图连接与供电模式审查

- 日期：2026-08-11
- 工作目录或项目：`C:\Users\29925\Documents\temp`；实用新型申请 `202522091725.2`
- 专业领域：磁性角度传感器、DC/DC 与 LDO 供电、专利电路公开充分性
- 设备与版本：ams AS5600-ASOT（SOIC-8）；官方数据表 `AS5600-DS000365` v1-06（2018-06-20）
- 现象：第一次审查意见指出信号采集模块、电源模块与控制器之间的引脚连接和具体电路不清楚，同时未说明降压稳压芯片与线性稳压芯片型号。
- 已确认事实和证据：原说明书图2和图4的三针接口实际同号对应，`1=GND`、`2=+5V`、`3=OUT/摇杆信号`，图4的信号端经 R30、R31 接入 U11 的 `P0_00`，节点由 R80、C11 接地；图3可辨识 U8 的 IN/EN/GND/FB/LX/BS 端、L1 与 R134/R133 反馈网络，以及 U7 的 VIN/GND/VOUT 连接，但原说明书和权利要求未记载 U8、U7 商品型号或元件值。图2同时画出 AS5600 的 VDD5V 接 +5V、VDD3V3 经 SR3 接 +5V并经 SC2 接地。官方数据表规定：5V 模式下 VDD5V 接 4.5–5.5V并以 100nF 去耦，VDD3V3 仅以外部 1µF 电容接地；只有 3.3V 模式才把 VDD5V 与 VDD3V3 相连，且 VDD3V3 绝对最大值为 4.0V。
- 根因：跨附图的同名网络和端子对应没有在正文中形成明确的逐脚连接表；稳压电路只有功能端拓扑而没有型号/参数；AS5600 图中混入了相互排斥的 5V 与 3.3V 供电连接方式，且 SR3 的阻值和装配状态未知。
- 处理方法：本轮未修改申请文件或现场电路。建议先以专利业务系统中的申请日正式文件为修改基准，把附图2—4已经公开的端子映射、信号调理路径和 U8/U7 功能端拓扑逐项写入说明书与权利要求；不得凭引脚排列猜测 U8/U7 型号，也不得在没有原始依据时新增元件值或把 SR3 擅自改成 0Ω、DNP 或删除。AS5600 数据表只用于核对公知器件能力和发现供电矛盾，不作为新增技术内容依据。
- 验证方法与结果：读取原 DOCX 文本和全部嵌入附图，对图4连接器局部进行原始分辨率放大，确认 DP2/P2 针号一致且下拉电阻标号为 R80；读取审查意见 PDF；下载并检索制造商官方数据表的 Pin Assignments、IC Power Management、Ordering Information。完成只读审查，未验证实物 PCB、BOM、SR3 装配状态或稳压芯片实际型号。
- 资料来源：`C:\Users\29925\Documents\temp\实用新型-一种电动平衡车的转向角度采集电路.docx`；`C:\Users\29925\Documents\temp\第一次审查意见通知书-2025220917252-一种电动平衡车的转向角度采集电路-小刀新能源科技股份有限公司(2).pdf`；ams OSRAM《AS5600 Datasheet》v1-06，https://look.ams-osram.com/m/7059eac7531a86fd/original/AS5600-DS000365.pdf，访问日期 2026-08-11。
- 适用范围与安全边界：该结论只证明当前申请文件与 AS5600 官方 5V/3.3V 供电规则之间的关系，不证明样机实际接线。专利补正必须受申请日原始公开范围限制；真实 BOM 或后补数据表不能自动成为新增型号、数值或连接的原始依据。电路投产前应由硬件工程师核对原理图、BOM、PCB 网表和实测电压。

## 待验证假设

暂无。

## 已失效经验

暂无。验证失败或因版本变化不再适用的条目移到这里，并注明失效原因和日期。
