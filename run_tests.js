const child_process = require("child_process");
const fs = require("fs");
const path = require("path");

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function findMsysBin(msysRoot) {
	const candidates = [
		path.join(msysRoot, "usr", "bin", "cal.exe"),
		path.join(msysRoot, "usr", "bin", "uname.exe"),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate))
			return candidate;
	}
	throw new Error(`Could not find cal.exe or uname.exe under ${msysRoot}`);
}

function writeBat(dir, name, lines) {
	const filePath = path.join(dir, name);
	fs.writeFileSync(filePath, lines.join("\r\n") + "\r\n", "utf8");
	return filePath;
}

async function runNodeScenario(name, batRelativePath, workDir) {
	console.log(`\n==================== ${name} ====================`);
	const outputChunks = [];
	const proc = child_process.spawn(batRelativePath, [], { cwd: workDir, shell: true });

	let resolveStarted;
	const startedPromise = new Promise((resolve) => { resolveStarted = resolve; });

	const appendOutput = (prefix, data) => {
		const text = data.toString();
		outputChunks.push(text);
		for (const line of text.split(/\r?\n/)) {
			if (line.length > 0)
				console.log(`${prefix}${line}`);
		}
		if (text.includes("Flutter Daemon started!"))
			resolveStarted();
	};

	proc.stdout.on("data", (data) => appendOutput("    <== ", data));
	proc.stderr.on("data", (data) => appendOutput("        <== ERROR == ", data));
	proc.stdin.on("error", (err) => {
		const msg = `stdin error: ${err.message}`;
		outputChunks.push(msg + "\n");
		console.log(`        <== ${msg}`);
	});
	proc.on("error", (err) => {
		const msg = `process error: ${err.message}`;
		outputChunks.push(msg + "\n");
		console.log(`        <== ERROR! == ${msg}`);
	});

	const closePromise = new Promise((resolve) => {
		proc.on("close", (code, signal) => {
			console.log(`    [exit: ${code}, ${signal}]`);
			resolve();
		});
	});

	await Promise.race([startedPromise, sleep(5000)]);
	await sleep(300);

	for (let i = 1; i <= 4; i++) {
		const msg = `Hello ${i}`;
		console.log(`==> ${msg}`);
		try {
			if (proc.stdin.writable)
				proc.stdin.write(`${msg}\n`);
		} catch (err) {
			console.log(`    [stdin write error: ${err.message}]`);
		}
		await sleep(400);
	}

	await sleep(600);
	console.log("Finishing!");
	if (proc.pid)
		child_process.spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
	await Promise.race([closePromise, sleep(2000)]);

	return parseResult(name, outputChunks.join(""));
}

async function runDartClientScenario(name, dartClientPath, batPath, workDir) {
	console.log(`\n==================== ${name} ====================`);
	const outputChunks = [];
	const proc = child_process.spawn("dart.exe", [dartClientPath, batPath], { cwd: workDir });

	const appendOutput = (prefix, data) => {
		const text = data.toString();
		outputChunks.push(text);
		for (const line of text.split(/\r?\n/)) {
			if (line.length > 0)
				console.log(`${prefix}${line}`);
		}
	};

	proc.stdout.on("data", (data) => appendOutput("", data));
	proc.stderr.on("data", (data) => appendOutput("[STDERR] ", data));
	proc.on("error", (err) => {
		const msg = `process error: ${err.message}`;
		outputChunks.push(msg + "\n");
		console.log(`[ERROR] ${msg}`);
	});

	const closePromise = new Promise((resolve) => {
		proc.on("close", (code, signal) => {
			console.log(`    [dart client exit: ${code}, ${signal}]`);
			resolve();
		});
	});

	let timedOut = false;
	await Promise.race([
		closePromise,
		sleep(15000).then(() => { timedOut = true; }),
	]);

	if (timedOut && proc.pid) {
		console.log("    [dart client timed out, killing]");
		child_process.spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
	}

	return parseResult(name, outputChunks.join(""));
}

function parseResult(name, fullOutput) {
	const pipeMatch = /PIPE_STATE ok=(\S+) state=(\S+) PIPE_NOWAIT=(true|false)/.exec(fullOutput);
	const resetMatch = /RESET_PIPE_WAIT ok=(\S+)/.exec(fullOutput);
	const streamDone = fullOutput.includes("Stream done! WERE YOU EXPECTING THIS?");
	const helloMatches = fullOutput.match(/Daemon was sent: Hello \d+/g) || [];

	return {
		name,
		pipeNowait: pipeMatch ? `${pipeMatch[3]} (${pipeMatch[2]})` : "unknown",
		resetOk: resetMatch ? resetMatch[1] : "-",
		streamDone: streamDone ? "YES" : "no",
		helloCount: `${helloMatches.length}/4`,
	};
}

function printSummary(results) {
	console.log("\n=== SUMMARY ===");
	const rows = results.map((r) => ({
		Scenario: r.name,
		"PIPE_NOWAIT (state)": r.pipeNowait,
		"RESET ok": r.resetOk,
		"Stream done": r.streamDone,
		"Replies": r.helloCount,
	}));
	console.table(rows);
	for (const r of results) {
		console.log(
			`SUMMARY_LINE | ${r.name} | PIPE_NOWAIT=${r.pipeNowait} | RESET=${r.resetOk} | StreamDone=${r.streamDone} | Replies=${r.helloCount}`
		);
	}
}

async function main() {
	const msysRoot = process.argv[2];
	if (!msysRoot) {
		console.error("Usage: node run_tests.js <msys2-root>");
		process.exit(1);
	}

	const workDir = __dirname;
	const msysBin = findMsysBin(msysRoot);
	console.log(`Using MSYS2 binary: ${msysBin}`);

	const batDir = path.join(workDir, "test_bats");
	fs.mkdirSync(batDir, { recursive: true });

	const fakeDaemonPath = path.join(workDir, "fake_daemon.dart");
	const dartClientPath = path.join(workDir, "daemon_client_dart.dart");

	const subForFBatPath = writeBat(batDir, "sub_for_f.bat", [
		"@ECHO off",
		`FOR /f "delims=" %%r IN ('"${msysBin}"') DO SET "rev=%%r"`,
	]);

	writeBat(batDir, "1_control_windows_git.bat", [
		"@ECHO off",
		"git.exe --version",
		`"dart.exe" "${fakeDaemonPath}"`,
	]);

	const bat2Path = writeBat(batDir, "2_repro_node_msys.bat", [
		"@ECHO off",
		`"${msysBin}"`,
		`"dart.exe" "${fakeDaemonPath}"`,
	]);

	writeBat(batDir, "3_repro_node_msys_for_f.bat", [
		"@ECHO off",
		`CALL "${subForFBatPath}"`,
		`"dart.exe" "${fakeDaemonPath}"`,
	]);

	writeBat(batDir, "5_node_msys_reset_pipe_wait.bat", [
		"@ECHO off",
		`"${msysBin}"`,
		`"dart.exe" "${fakeDaemonPath}" --reset-pipe-wait`,
	]);

	writeBat(batDir, "6_node_msys_redirect_nul.bat", [
		"@ECHO off",
		`"${msysBin}" < NUL`,
		`"dart.exe" "${fakeDaemonPath}"`,
	]);

	writeBat(batDir, "7_node_msys_call_shared_redirect_nul.bat", [
		"@ECHO off",
		`CALL "${subForFBatPath}" < NUL`,
		`"dart.exe" "${fakeDaemonPath}"`,
	]);

	const results = [];
	results.push(await runNodeScenario("control-windows-git", path.join("test_bats", "1_control_windows_git.bat"), workDir));
	results.push(await runNodeScenario("repro-node-msys", path.join("test_bats", "2_repro_node_msys.bat"), workDir));
	results.push(await runNodeScenario("repro-node-msys-for-f", path.join("test_bats", "3_repro_node_msys_for_f.bat"), workDir));
	results.push(await runDartClientScenario("dart-client-msys", dartClientPath, bat2Path, workDir));
	results.push(await runNodeScenario("node-msys-reset-pipe-wait", path.join("test_bats", "5_node_msys_reset_pipe_wait.bat"), workDir));
	results.push(await runNodeScenario("node-msys-redirect-nul", path.join("test_bats", "6_node_msys_redirect_nul.bat"), workDir));
	results.push(await runNodeScenario("node-msys-call-shared-redirect-nul", path.join("test_bats", "7_node_msys_call_shared_redirect_nul.bat"), workDir));

	printSummary(results);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
