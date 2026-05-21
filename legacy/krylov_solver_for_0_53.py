import numpy as np

try:
    import scipy.sparse as sps
    import scipy.sparse.linalg as spla
    from scipy.linalg import expm
except Exception:
    sps = None
    spla = None
    expm = None


def arnoldi_iteration(A, b, k):
    """Build Krylov basis V and Hessenberg H for A,b."""
    b = np.asarray(b).reshape(-1)
    n = b.shape[0]
    k = max(1, min(int(k), n))
    dtype = np.complex128 if (np.iscomplexobj(A) or np.iscomplexobj(b)) else np.float64

    V = np.zeros((n, k + 1), dtype=dtype)
    H = np.zeros((k + 1, k), dtype=dtype)
    beta = np.linalg.norm(b)
    if beta == 0:
        return V[:, :1], H[:1, :0]
    V[:, 0] = b / beta

    for j in range(k):
        w = A @ V[:, j]
        for i in range(j + 1):
            H[i, j] = np.vdot(V[:, i], w)
            w = w - H[i, j] * V[:, i]
        H[j + 1, j] = np.linalg.norm(w)
        if H[j + 1, j] < 1e-15:
            return V[:, :j + 2], H[:j + 2, :j + 1]
        V[:, j + 1] = w / H[j + 1, j]
    return V, H


def krylov_exp_mv(A, v, t, k=30):
    """Approximate exp(tA) v using Arnoldi projection."""
    if expm is None:
        raise RuntimeError("scipy.linalg.expm is required for krylov_exp_mv")
    v = np.asarray(v).reshape(-1)
    beta = np.linalg.norm(v)
    if beta < 1e-30:
        return np.zeros_like(v)
    V, H = arnoldi_iteration(A, v, k)
    m = H.shape[1]
    Hm = H[:m, :m]
    e1 = np.zeros((m,), dtype=Hm.dtype)
    e1[0] = 1.0
    return beta * (V[:, :m] @ (expm(t * Hm) @ e1))


def build_ilu_preconditioner(A_sparse):
    if spla is None:
        return None
    try:
        A_csc = A_sparse if getattr(A_sparse, "format", None) == "csc" else A_sparse.tocsc()
        ilu = spla.spilu(A_csc, fill_factor=10, drop_tol=1e-6)
        return spla.LinearOperator(A_csc.shape, matvec=ilu.solve)
    except Exception:
        return None


def krylov_solve_linear(A, b, tol=1e-9, maxiter=2000, restart=80, preconditioner=None, x0=None):
    """
    Solve A x = b with GMRES (+ optional ILU preconditioner).
    Returns (x, info_dict). Falls back to direct solve when needed.
    """
    b_arr = np.asarray(b)
    b_was_col = (b_arr.ndim == 2 and b_arr.shape[1] == 1)
    b_1d = b_arr.reshape(-1)

    if spla is None or sps is None:
        x = np.linalg.solve(np.asarray(A), b_arr)
        return x, {"converged": True, "method": "dense_direct_no_scipy"}

    try:
        A_csc = sps.csc_matrix(A)
        M = preconditioner if preconditioner is not None else build_ilu_preconditioner(A_csc)
        x, flag = spla.gmres(
            A_csc,
            b_1d,
            x0=x0,
            rtol=float(tol),
            atol=0.0,
            restart=min(max(5, int(restart)), A_csc.shape[0]),
            maxiter=int(maxiter),
            M=M,
        )
        if flag == 0:
            out = x.reshape(-1, 1) if b_was_col else x
            return out, {"converged": True, "method": "gmres"}
    except Exception:
        pass

    try:
        x = spla.spsolve(sps.csc_matrix(A), b_1d)
        out = x.reshape(-1, 1) if b_was_col else x
        return out, {"converged": True, "method": "spsolve_fallback"}
    except Exception:
        x = np.linalg.solve(np.asarray(A), b_arr)
        return x, {"converged": True, "method": "dense_direct_fallback"}


def adaptive_krylov_order(A, b, tol=1e-8, k_min=10, k_max=300, k_step=10):
    """Simple adaptive k chooser based on Arnoldi residual estimate."""
    b = np.asarray(b).reshape(-1)
    n = A.shape[0]
    k_max = min(int(k_max), n)
    beta = np.linalg.norm(b)
    if beta < 1e-30:
        return int(k_min)
    for k in range(int(k_min), k_max + 1, int(k_step)):
        V, H = arnoldi_iteration(A, b, k)
        m = H.shape[1]
        rhs = np.zeros((m + 1,))
        rhs[0] = beta
        try:
            y, *_ = np.linalg.lstsq(H[:m + 1, :m], rhs, rcond=None)
            xk = V[:, :m] @ y
            rel = np.linalg.norm((A @ xk) - b) / beta
            if rel < tol:
                return k
        except Exception:
            continue
    return k_max
