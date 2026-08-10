# FiveDofPlatform v26085 Modbus 寄存器集中修改记录

时间：2026-08-01
版本：v26085

## 现场问题

Python 已经写入点动总开关 `arReg_data[19]` 和方向寄存器 `arReg_data[6..15]`，但状态为 `0x0002`，表示轴处于 `Errorstop`。Errorstop 状态下 `MC_Jog` 不会执行，需要先通过 `MC_Reset` 复位。

## 本次 CODESYS 修改

- 所有 `arReg_data[...]` 和 `arAi_data[...]` 非注释代码读写集中到 `ModbusTcpSlave`。
- `FiveDOF_Platform_PRG` 不再写 `arAi_data[9]`，只维护 `bfiveDOF_state`，由 `ModbusTcpSlave` 写输入寄存器。
- `AxisEnableControl_PRG` 改为占位程序，不再读写寄存器。
- `AxisStatusFeedback_PRG` 只写全局缓存：`wAxisStatusReg`、`dwAxisErrorIDReg`、`dwReadStatusErrorIDReg`、`dwReadAxisErrorFBIDReg` 等。
- 单轴程序只写 `dwPowerErrorIDReg` 和 `wPowerDiagReg`，不再直接写 `[69..83]`。
- Jog 程序只读 `xJogReset[1..5]`，只写 `wJog...Reg` 反馈位图，不再直接读写寄存器。
- `ModbusTcpSlave` 增加完整中文注释，集中解析 `[0..19]`、`[32]`、`[89]`，集中输出 `[33..99]` 和 `arAi_data[1..5]`、`arAi_data[9]`。

## 本次 Python 修改

- 底层库新增 `RESET_REGISTER = 89` 和 `reset_axes()`。
- 新脚本 `test_fivedofplat_v26085.py` 新增：
  - `--reset-all`
  - `--reset-axis 1 3`
  - `--reset-pulse 0.2`
- 诊断版本期望值改为 `26085`。

## 验证

- CODESYS v26085 导入成功。
- 删除旧同名 POU 和 `_1` 自动副本后重新导入成功。
- CODESYS 重新编译结果：0 errors，0 warnings。
- 导出 XML 后静态检查：除 `ModbusTcpSlave` 外，非注释代码中 `arReg_data[...]` / `arAi_data[...]` 访问数量为 0。
- Python v26085 离线测试通过。

## 现场使用顺序

1. 下载并运行 `C:\path\FiveDofPlatform_v26085.project` 到 PLC。
2. Python 执行：`python test_fivedofplat_v26085.py --reset-all`
3. Python 执行：`python test_fivedofplat_v26085.py --enable-all`
4. Python 执行：`python test_fivedofplat_v26085.py --jog --axis 1 --direction fwd`

注意：本次我没有下载 PLC，没有启动/停止 PLC。
