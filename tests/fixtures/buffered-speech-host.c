#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static pid_t owned = -1;

static void stop_owned(int signal_number) {
    if (owned > 0) kill(owned, signal_number);
}

int main(int argc, char **argv) {
    int channel[2];
    if (argc < 2 || pipe(channel) != 0) return 20;
    owned = fork();
    if (owned < 0) return 21;
    if (owned == 0) {
        close(channel[0]);
        if (dup2(channel[1], STDOUT_FILENO) < 0) _exit(22);
        close(channel[1]);
        execvp(argv[1], argv + 1);
        _exit(23);
    }
    close(channel[1]);
    struct sigaction action = {0};
    action.sa_handler = stop_owned;
    sigemptyset(&action.sa_mask);
    sigaction(SIGTERM, &action, NULL);
    sigaction(SIGINT, &action, NULL);
    setvbuf(stdout, NULL, _IOFBF, 65536);
    char buffer[4096];
    for (;;) {
        ssize_t count = read(channel[0], buffer, sizeof(buffer));
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) break;
        if (fwrite(buffer, 1, (size_t)count, stdout) != (size_t)count) {
            stop_owned(SIGTERM);
            break;
        }
    }
    close(channel[0]);
    int status;
    while (waitpid(owned, &status, 0) < 0) {
        if (errno != EINTR) return 24;
    }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 25;
}
