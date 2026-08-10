# FiveDofPlatform PLC/Python 联动寄存器表

生成时间: 2026-08-04T08:22:03.675Z
CODESYS工程: C:\path\FiveDofPlatform_v26082.project
PLCopenXML: C:\path\export\FiveDofPlatform_v26082.plcopenxml
Python仓库: C:\Users\29925\Documents\工作资料\daqctrl
Python脚本: C:\Users\29925\Documents\工作资料\daqctrl\test_down.py
Python本机IP: 192.168.31.100
设备: fivedof (192.168.1.30:502)

## 使用原则

- CODESYS 作为 PLC 执行程序，Python 作为上位机控制程序。
- Python 通过 Modbus/485 工作流控制 PLC 寄存器；写寄存器动作应在确认现场安全后执行。
- 客户端默认联动检查和生成寄存器表不写 PLC；只读反馈只读取反馈寄存器。

## 寄存器表

| 地址 | 方向 | 分组 | 功能 |
|---:|---|---|---|
| `arReg_data[0]` | Python/HMI -> PLC | 控制 | 五轴绝对定位启动命令 |
| `arReg_data[1..5]` | Python/HMI -> PLC | 控制 | X/Y/Z/B/C 五轴目标位置原始值 |
| `arReg_data[6..15]` | Python/HMI -> PLC | 控制 | X/Y/Z/B/C 正反向点动方向命令 |
| `arReg_data[19]` | Python/HMI -> PLC | 控制 | 点动总开关位图：bit0=X、bit1=Y、bit2=Z、bit3=B、bit4=C |
| `arReg_data[32]` | Python/HMI -> PLC | 控制 | 五轴总使能命令：0=关闭，非0=打开 |
| `arReg_data[89]` | Python/HMI -> PLC | 控制 | 五轴复位命令位图，写短脉冲后清 0 |
| `arAi_data[1..5]` | PLC -> Python/HMI | 反馈 | X/Y/Z/B/C 五轴当前位置反馈 |
| `arReg_data[33..37]` | PLC -> Python/HMI | 反馈 | X/Y/Z/B/C 五轴状态字 |
| `arReg_data[38..47]` | PLC -> Python/HMI | 反馈 | X/Y/Z/B/C AxisErrorID 低/高 16 位 |
| `arReg_data[48]` | PLC -> Python/HMI | 反馈 | 五轴使能请求反馈，bit0..bit4 和 bit15 |
| `arReg_data[49..58]` | PLC -> Python/HMI | 反馈 | X/Y/Z/B/C MC_ReadStatus.ErrorID 低/高 16 位 |
| `arReg_data[59..68]` | PLC -> Python/HMI | 反馈 | X/Y/Z/B/C MC_ReadAxisError.ErrorID 低/高 16 位 |
| `arReg_data[69..78]` | PLC -> Python/HMI | 反馈 | X/Y/Z/B/C MC_Power.ErrorID 低/高 16 位 |
| `arReg_data[79..83]` | PLC -> Python/HMI | 反馈 | X/Y/Z/B/C MC_Power 诊断字，bit0=Status，bit1=Error |
| `arReg_data[84]` | PLC -> Python/HMI | 反馈 | 轴状态诊断版本号，v26086 固定为 26086 |
| `arReg_data[85..88]` | PLC -> Python/HMI | 反馈 | 使能不一致、状态读取、轴错误读取、FB 错误位图 |
| `arReg_data[90..99]` | PLC -> Python/HMI | 反馈 | 复位、点动进入 FB 前和 FB_ServoJog 诊断反馈；[99] 为 v26086 |

## 当前代码扫描

- Python寄存器引用: {}
- CODESYS XML寄存器引用: {"arReg_data":[0,6,7,8,9,10,11,12,13,14,15,19,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,100,101,102],"arAi_data":[9]}
- Python控制类: 未识别
- Python只读接口: 未识别
- Python写入接口: 未识别

## 当前 Python Modbus 调用

| 行 | 方法 | 操作 | 地址 | 方向 |
|---:|---|---|---|---|
| - | - | 未识别当前 Python 代码中的 Modbus 调用 | - | - |

## 快捷验证命令

```powershell
python C:\Users\29925\codex-local-client\tools\plc_link_runner.py --python-root C:\Users\29925\Documents\工作资料\daqctrl --script C:\Users\29925\Documents\工作资料\daqctrl\test_down.py --class-name ControlFiveDOF --ip 192.168.1.30 --port 502 --action import_check
python C:\Users\29925\codex-local-client\tools\plc_link_runner.py --python-root C:\Users\29925\Documents\工作资料\daqctrl --script C:\Users\29925\Documents\工作资料\daqctrl\test_down.py --class-name ControlFiveDOF --ip 192.168.1.30 --port 502 --action read_positions
```
