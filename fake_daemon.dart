import 'dart:convert';
import 'dart:ffi';
import 'dart:io';

void checkStdinPipe({bool resetToWait = false}) {
  final kernel32 = DynamicLibrary.open('kernel32.dll');
  final localAlloc = kernel32.lookupFunction<
      Pointer<Uint32> Function(Uint32, IntPtr),
      Pointer<Uint32> Function(int, int)>('LocalAlloc');
  final getStdHandle = kernel32.lookupFunction<
      IntPtr Function(Int32),
      int Function(int)>('GetStdHandle');
  final getPipeState = kernel32.lookupFunction<
      Int32 Function(IntPtr, Pointer<Uint32>, Pointer<Void>, Pointer<Void>,
          Pointer<Void>, Pointer<Void>, Uint32),
      int Function(int, Pointer<Uint32>, Pointer<Void>, Pointer<Void>,
          Pointer<Void>, Pointer<Void>, int)>('GetNamedPipeHandleStateW');
  final setPipeState = kernel32.lookupFunction<
      Int32 Function(IntPtr, Pointer<Uint32>, Pointer<Void>, Pointer<Void>),
      int Function(int, Pointer<Uint32>, Pointer<Void>, Pointer<Void>)>(
    'SetNamedPipeHandleState',
  );

  final hStdin = getStdHandle(-10); // STD_INPUT_HANDLE
  final statePtr = localAlloc(0x40, 4); // LPTR (zero-initialized)
  final ok =
      getPipeState(hStdin, statePtr, nullptr, nullptr, nullptr, nullptr, 0);
  print(
    'PIPE_STATE ok=$ok state=0x${statePtr.value.toRadixString(16)} '
    'PIPE_NOWAIT=${(statePtr.value & 1) != 0}',
  );

  if (resetToWait && (statePtr.value & 1) != 0) {
    statePtr.value = 0; // PIPE_WAIT | PIPE_READMODE_BYTE
    final setOk = setPipeState(hStdin, statePtr, nullptr, nullptr);
    print('RESET_PIPE_WAIT ok=$setOk');
  }
}

Future<void> main(List<String> args) async {
  checkStdinPipe(resetToWait: args.contains('--reset-pipe-wait'));
  print('Flutter Daemon started!');

  stdin.transform(utf8.decoder).listen(
    (input) {
      for (final line in const LineSplitter().convert(input)) {
        if (line.trim().isNotEmpty) {
          print('Daemon was sent: $line');
        }
      }
    },
    onDone: () {
      print('Stream done! WERE YOU EXPECTING THIS?');
    },
    onError: (e, s) {
      print('ERROR! $e\n$s');
    },
  );

  await Future<void>.delayed(const Duration(seconds: 15));
}
