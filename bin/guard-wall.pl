# Runs the guard (argv) with a 30 s wall limit, for the guard.sh wrappers.
# The guard runs in its own process group and the whole group is killed, so a child it started can't outlive it and hold
# the hook's pipes open. The guard also keeps its own alarm (alarms survive exec): if this watcher is killed, it still dies.
my $p = fork;
if (!defined $p) { alarm 30; exec { $ARGV[0] } @ARGV; exit 127 }
if (!$p) { setpgrp(0, 0); alarm 31; exec { $ARGV[0] } @ARGV; exit 127 }
my $end = sub { kill 'KILL', -$p; waitpid $p, 0; exit 137 };
$SIG{$_} = $end for qw(ALRM TERM HUP INT);
alarm 30;
waitpid $p, 0; my $s = $?;
alarm 0; kill 'KILL', -$p; # finished: anything it left behind goes too
exit($s & 127 ? 128 + ($s & 127) : $s >> 8);
