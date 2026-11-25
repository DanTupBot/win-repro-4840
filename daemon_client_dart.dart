import 'dart:async';
import 'dart:convert';
import 'dart:io';

Future<void> main(List<String> args) async {
  if (args.isEmpty) {
    stderr.writeln('Usage: dart daemon_client_dart.dart <bat-file>');
    exit(2);
  }

  final batFile = args[0];
  final proc = await Process.start(batFile, []);
  final started = Completer<void>();

  proc.stdout
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .listen((line) {
    print('    <== $line');
    if (line.contains('Flutter Daemon started!') && !started.isCompleted) {
      started.complete();
    }
  });

  proc.stderr
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .listen((line) {
    print('        <== ERROR == $line');
  });

  await started.future.timeout(const Duration(seconds: 5), onTimeout: () {});
  await Future<void>.delayed(const Duration(milliseconds: 300));

  for (var i = 1; i <= 4; i++) {
    final msg = 'Hello $i';
    print('==> $msg');
    proc.stdin.writeln(msg);
    await Future<void>.delayed(const Duration(milliseconds: 400));
  }

  await Future<void>.delayed(const Duration(milliseconds: 600));
  print('Finishing!');
  proc.kill();
  if (Platform.isWindows) {
    Process.runSync('taskkill', ['/PID', '${proc.pid}', '/T', '/F']);
  }
  exit(0);
}
