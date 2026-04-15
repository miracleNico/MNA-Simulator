"""Numerical solvers shared by basic and advanced cores."""

from __future__ import annotations

import re
import time

import numpy as np
import sympy as sp
from numpy.linalg import norm

from .api.contracts import MnaProblem, SpectrumResult, WaveformResult
from .errors import error_handler


def lu_decomposition(matrix: np.ndarray) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Doolittle LU decomposition without pivoting."""

    n = matrix.shape[0]
    L = np.zeros((n, n))
    U = np.zeros((n, n))

    for k in range(n):
        L[k, k] = 1

        for j in range(k, n):
            U[k, j] = matrix[k, j] - np.dot(L[k, :k], U[:k, j])

        if np.abs(U[k, k]) < 1e-18:
            return None, None

        for i in range(k + 1, n):
            L[i, k] = (matrix[i, k] - np.dot(L[i, :k], U[:k, k])) / U[k, k]

    return L, U


def forward_substitution(L: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Solve L*y=b for lower triangular L."""

    n = L.shape[0]
    y = np.zeros((n, 1), dtype=b.dtype)
    for i in range(n):
        y[i] = b[i] - np.dot(L[i, :i], y[:i])
    return y


def backward_substitution(U: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Solve U*x=y for upper triangular U."""

    n = U.shape[0]
    x = np.zeros((n, 1), dtype=y.dtype)
    for i in range(n - 1, -1, -1):
        x[i] = (y[i] - np.dot(U[i, i + 1 :], x[i + 1 :])) / U[i, i]
    return x


def compile_nl_functions(f_str_vector: np.ndarray, size: int):
    """Compile nonlinear current expressions and their Jacobian."""

    x_vars = sp.symbols(f"x_0:{size}")
    expressions: list[sp.Expr] = []

    for expr_str in f_str_vector.flatten():
        expression = str(expr_str)
        for i in range(size):
            expression = expression.replace(f"x[{i}]", f"x_{i}")
        expression = expression.replace("np.", "sp.")
        expressions.append(sp.sympify(expression, locals={"sp": sp}))

    f_sym = sp.Matrix(expressions)
    J_sym = f_sym.jacobian(x_vars)
    return sp.lambdify(x_vars, f_sym, "numpy"), sp.lambdify(x_vars, J_sym, "numpy")


def compile_time_source_func(b_time_str_vector: np.ndarray):
    """Compile time-domain source expressions into a callable."""

    size = b_time_str_vector.shape[0]
    t = sp.symbols("t")
    expressions: list[sp.Expr] = []

    for expr_str in b_time_str_vector.flatten():
        expr = str(expr_str).replace("heaviside", "Heaviside").replace("np.m", "sp.M").replace("np.", "sp.")
        expr = re.sub(r"(sp\.(?:Min|Max))\(\[(.*?)\]\)", r"\1(\2)", expr)
        expressions.append(sp.sympify(expr, locals={"sp": sp, "t": t}))

    compiled = sp.lambdify(t, sp.Matrix(expressions), "numpy")

    def evaluate(t_value: float) -> np.ndarray:
        return np.asarray(compiled(t_value), dtype=float).reshape(size, 1)

    return evaluate


def is_nonlinear(f_str_vector: np.ndarray) -> bool:
    """Return True when the symbolic nonlinear vector is non-zero."""

    return any(expr != "0" for expr in f_str_vector.flatten())


def solve_dc_nr(
    G: np.ndarray,
    f_str_vector: np.ndarray,
    b: np.ndarray,
    max_iter: int = 10000,
    v_tol: float = 1e-9,
    f_tol: float = 1e-9,
    init_cond: np.ndarray | str = "DEFAULT",
) -> np.ndarray:
    """Solve the DC operating point using linear solve or Newton-Raphson."""

    size = G.shape[0]
    if not is_nonlinear(f_str_vector):
        L, U = lu_decomposition(G)
        if L is None or U is None:
            error_handler("NR_CONVERGENCE: Linear system is singular (G matrix).")
        return backward_substitution(U, forward_substitution(L, b))

    f_func, Jf_func = compile_nl_functions(f_str_vector, size)
    if isinstance(init_cond, str):
        if init_cond == "DEFAULT":
            x = np.zeros((size, 1))
        elif init_cond == "RANDOM":
            x = np.random.uniform(-1.0, 1.0, size=(size, 1))
        else:
            error_handler(f"NETLIST_FATAL: Unsupported init condition '{init_cond}'.")
    else:
        x = init_cond.copy()

    norm_F_now = np.inf
    for iteration in range(max_iter):
        x_flat = x.flatten()
        f_k = np.asarray(f_func(*x_flat), dtype=float).reshape(size, 1)
        F_k = (G @ x) + f_k - b

        norm_F_prev = norm_F_now
        norm_F_now = np.linalg.norm(F_k)
        if norm_F_now < f_tol:
            return x

        Jf_k = np.asarray(Jf_func(*x_flat), dtype=float)
        J_k = G + Jf_k

        try:
            delta_x = np.linalg.solve(J_k, -F_k)
        except np.linalg.LinAlgError as exc:
            error_handler(f"JACOBIAN_SINGULAR: Jacobian is singular at iteration {iteration}.")
            raise exc

        x = x + delta_x
        if np.linalg.norm(delta_x) < v_tol:
            return x

        if norm_F_now > norm_F_prev:
            attenuation = 0.5
            for _ in range(20):
                trial = x - delta_x + delta_x * attenuation
                trial_flat = trial.flatten()
                f_trial = np.asarray(f_func(*trial_flat), dtype=float).reshape(size, 1)
                F_trial = (G @ trial) + f_trial - b
                if np.linalg.norm(F_trial) <= norm_F_prev:
                    x = trial
                    break
                attenuation *= 0.5

    error_handler(f"NR_CONVERGENCE: Solver did not converge after {max_iter} iterations.")


def solve_transient(
    problem: MnaProblem,
    t_stop: float,
    t_step: float,
    max_iter: int = 10000,
    v_tol: float = 1e-9,
    f_tol: float = 1e-9,
    init_cond: np.ndarray | None = None,
) -> WaveformResult:
    """Solve transient response with backward Euler."""

    size = problem.G.shape[0]
    if is_nonlinear(problem.f_str):
        f_func, Jf_func = compile_nl_functions(problem.f_str, size)
    else:
        f_func = lambda *args: np.zeros((size, 1))  # noqa: E731
        Jf_func = lambda *args: np.zeros((size, size))  # noqa: E731

    b_time_func = compile_time_source_func(problem.b_time_str)

    if init_cond is None:
        b_t0 = problem.b_dc + b_time_func(0.0)
        x_prev = solve_dc_nr(problem.G, problem.f_str, b_t0, max_iter=max_iter, v_tol=v_tol, f_tol=f_tol)
    else:
        x_prev = init_cond.copy()

    t_points = np.arange(0, t_stop + t_step, t_step)
    values = np.zeros((size, len(t_points)))
    values[:, 0] = x_prev.flatten()

    C_h = problem.C / t_step
    G_be = problem.G + C_h

    for step in range(1, len(t_points)):
        x_k = x_prev.copy()
        b_now = problem.b_dc + b_time_func(float(t_points[step]))
        b_be = (C_h @ x_prev) + b_now
        converged = False

        for iteration in range(max_iter):
            x_flat = x_k.flatten()
            f_k = np.asarray(f_func(*x_flat), dtype=float).reshape(size, 1)
            F_k = (G_be @ x_k) + f_k - b_be

            if np.linalg.norm(F_k) < f_tol:
                converged = True
                break

            Jf_k = np.asarray(Jf_func(*x_flat), dtype=float)
            J_k = G_be + Jf_k

            try:
                delta_x = np.linalg.solve(J_k, -F_k)
            except np.linalg.LinAlgError as exc:
                error_handler(f"JACOBIAN_SINGULAR: Jacobian singular at t={t_points[step]:.2e}, iter={iteration}")
                raise exc

            x_k = x_k + delta_x
            if np.linalg.norm(delta_x) < v_tol:
                converged = True
                break

        if not converged:
            error_handler(f"NR_CONVERGENCE: NR failed to converge at t={t_points[step]:.2e} s")

        values[:, step] = x_k.flatten()
        x_prev = x_k

    return WaveformResult(time=t_points, values=values, labels=problem.metadata["labels"])


def solve_ac(problem: MnaProblem, f_start: float, f_stop: float, points: int) -> SpectrumResult:
    """Solve linear small-signal AC response over a frequency sweep."""

    if is_nonlinear(problem.f_str):
        dc_solution = solve_dc_nr(problem.G, problem.f_str, problem.b_dc)
        f_func, Jf_func = compile_nl_functions(problem.f_str, problem.G.shape[0])
        jacobian = np.asarray(Jf_func(*dc_solution.flatten()), dtype=float)
        G_linearized = problem.G + jacobian
    else:
        G_linearized = problem.G

    frequencies = np.linspace(f_start, f_stop, points)
    responses = np.zeros((problem.G.shape[0], points))

    for index, frequency in enumerate(frequencies):
        omega = 2 * np.pi * frequency
        system = G_linearized + 1j * omega * problem.C
        try:
            solution = np.linalg.solve(system, problem.b_ac)
        except np.linalg.LinAlgError as exc:
            error_handler(f"AC_ERROR: AC solve failed at frequency {frequency:.3e} Hz.")
            raise exc
        responses[:, index] = np.abs(solution.flatten())

    return SpectrumResult(frequencies=frequencies, magnitudes=responses, labels=problem.metadata["labels"])


def create_fourier_matrices(n_harmonics: int, time_points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return DFT and inverse DFT matrices for real-valued harmonics."""

    S = 2 * n_harmonics + 1
    K = len(time_points)
    Gamma = np.zeros((S, K))
    Gamma_inv = np.zeros((K, S))

    for k in range(K):
        Gamma_inv[k, 0] = 1.0
        for h in range(1, n_harmonics + 1):
            angle = 2 * np.pi * h * k / K
            Gamma_inv[k, 2 * h - 1] = np.cos(angle)
            Gamma_inv[k, 2 * h] = np.sin(angle)

    Gamma[0, :] = 1.0 / K
    for h in range(1, n_harmonics + 1):
        for k in range(K):
            angle = 2 * np.pi * h * k / K
            Gamma[2 * h - 1, k] = (2.0 / K) * np.cos(angle)
            Gamma[2 * h, k] = (2.0 / K) * np.sin(angle)

    return Gamma, Gamma_inv


def reconstruct_time_domain(x_bar: np.ndarray, num_vars: int, H: int, omega_0: float, t_array: np.ndarray) -> np.ndarray:
    """Reconstruct time-domain waveform from harmonic coefficients."""

    freq_dim = 2 * H + 1
    results = np.zeros((num_vars, len(t_array)))
    reshaped = x_bar.reshape((num_vars, freq_dim))

    for i in range(num_vars):
        values = np.full_like(t_array, reshaped[i, 0], dtype=float)
        for h in range(1, H + 1):
            a_h = reshaped[i, 2 * h - 1]
            b_h = reshaped[i, 2 * h]
            values += a_h * np.cos(h * omega_0 * t_array) + b_h * np.sin(h * omega_0 * t_array)
        results[i, :] = values

    return results


def solve_harmonic_balance(
    problem: MnaProblem,
    omega_0: float,
    H: int,
    max_iter: int = 100,
    tol: float = 1e-6,
) -> np.ndarray:
    """Solve the harmonic balance system."""

    num_vars = problem.G.shape[0]
    freq_dim = 2 * H + 1
    total_dim = num_vars * freq_dim

    G_bar = np.kron(problem.G, np.eye(freq_dim))
    C_bar = np.kron(problem.C, np.eye(freq_dim))

    Omega_block = np.zeros((freq_dim, freq_dim))
    for h in range(1, H + 1):
        w_h = h * omega_0
        idx_cos = 2 * h - 1
        idx_sin = 2 * h
        Omega_block[idx_cos, idx_sin] = w_h
        Omega_block[idx_sin, idx_cos] = -w_h

    Omega_bar = np.kron(np.eye(num_vars), Omega_block)
    Y_bar = G_bar + (C_bar @ Omega_bar)

    K_samples = 2 * H + 1
    period = 2 * np.pi / omega_0
    t_points = np.linspace(0, period, K_samples, endpoint=False)
    Gamma, Gamma_inv = create_fourier_matrices(H, t_points)

    b_bar = np.zeros((total_dim, 1))
    for index in range(num_vars):
        base = index * freq_dim
        b_bar[base] = problem.b_dc[index]

    b_time_func = compile_time_source_func(problem.b_time_str)
    b_time_matrix = np.zeros((num_vars, K_samples))
    for k, t_value in enumerate(t_points):
        b_time_matrix[:, k] = b_time_func(float(t_value)).flatten()
    for index in range(num_vars):
        base = index * freq_dim
        b_bar[base : base + freq_dim, 0] += Gamma @ b_time_matrix[index, :]

    if not is_nonlinear(problem.f_str):
        try:
            return np.linalg.solve(Y_bar, b_bar)
        except np.linalg.LinAlgError as exc:
            error_handler("HB_ERROR: Linear harmonic solve failed.")
            raise exc

    f_func, Jf_func = compile_nl_functions(problem.f_str, num_vars)
    x_bar = np.zeros((total_dim, 1))

    for _ in range(max_iter):
        x_reshaped = x_bar.reshape((num_vars, freq_dim))
        x_time = x_reshaped @ Gamma_inv.T

        i_nl_time = np.zeros((num_vars, K_samples))
        G_nl_time = np.zeros((num_vars, num_vars, K_samples))

        for k in range(K_samples):
            v_inst = x_time[:, k]
            i_nl_time[:, k] = np.asarray(f_func(*v_inst), dtype=float).flatten()
            G_nl_time[:, :, k] = np.asarray(Jf_func(*v_inst), dtype=float)

        f_bar = (i_nl_time @ Gamma.T).reshape((total_dim, 1))
        residual = (Y_bar @ x_bar) + f_bar - b_bar

        if np.linalg.norm(residual) < tol:
            return x_bar

        J_nonlinear = np.zeros((total_dim, total_dim))
        for r in range(num_vars):
            for c in range(num_vars):
                g_waveform = G_nl_time[r, c, :]
                weighted = g_waveform[:, None] * Gamma_inv
                block = Gamma @ weighted
                r_idx = r * freq_dim
                c_idx = c * freq_dim
                J_nonlinear[r_idx : r_idx + freq_dim, c_idx : c_idx + freq_dim] = block

        try:
            delta_x = np.linalg.solve(Y_bar + J_nonlinear, -residual)
        except np.linalg.LinAlgError as exc:
            error_handler("HB_ERROR: Singular HB Jacobian.")
            raise exc

        x_bar = x_bar + delta_x

    error_handler("HB_ERROR: Harmonic balance solver did not converge within limit.")
