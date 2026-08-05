@echo off
call "C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
cd /d C:\Users\JasonJin06\Desktop\LogicPilot
cl /nologo /MDd /std:c++20 /utf-8 /EHsc /Fo%TEMP%\ /I dsl\compiler\include /I kernel\include /I build\windows-msvc-dev\generated /I build\windows-msvc-dev\vcpkg_installed\x64-windows\include scripts\_dump_flat.cpp /Fe:%TEMP%\dump_flat.exe /link build\windows-msvc-dev\dsl\compiler\logicpilot_dsl.lib build\windows-msvc-dev\dsl\compiler\tree_sitter_runtime.lib build\windows-msvc-dev\kernel\logicpilot_phase1b.lib build\windows-msvc-dev\kernel\logicpilot_kernel.lib build\windows-msvc-dev\vcpkg_installed\x64-windows\debug\lib\flatbuffers.lib legacy_stdio_definitions.lib
