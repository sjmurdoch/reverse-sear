"""Ground-truth simulator for a steak heating in a low oven.

This is deliberately *more* detailed than the model the phone app fits.  Its job
is to generate realistic synthetic cooks so we can check that the app's simple
three-parameter curve, and its measurement-scheduling rule, actually land the
core temperature where we asked.

Physics included
----------------
* 2-D transient conduction over the steak's cross-section (thickness x width),
  assuming the third dimension is long.  Quarter-domain with symmetry planes.
* Convective + radiative heat gain at the surface.
* Evaporative cooling at the surface, driven by the humidity difference between
  the saturated surface and the oven air (Lewis analogy for the mass-transfer
  coefficient).  Radiation is excluded from the analogy, which is what lets the
  wet surface sit slightly above the true wet-bulb temperature.
* A finite film of free surface water ("the steak starts damp"), and after it is
  gone, a drying crust whose vapour resistance grows with the mass evaporated.
* Optional oven thermostat cycling and door-opening dips.

Units are SI throughout (kelvin is avoided except inside the radiation term).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

SIGMA = 5.670374419e-8  # Stefan-Boltzmann, W/m^2/K^4
P_ATM = 101325.0  # Pa


# --------------------------------------------------------------------------
# psychrometrics
# --------------------------------------------------------------------------
def p_sat(t_c: np.ndarray | float) -> np.ndarray | float:
    """Saturation vapour pressure of water, Pa, from the Magnus formula."""
    return 610.94 * np.exp(17.625 * t_c / (t_c + 243.04))


def humidity_ratio(t_c: np.ndarray | float, rh: float = 1.0) -> np.ndarray | float:
    """Humidity ratio (kg water / kg dry air) at temperature t_c."""
    p = np.minimum(rh * p_sat(t_c), 0.98 * P_ATM)
    return 0.622 * p / (P_ATM - p)


def latent_heat(t_c: np.ndarray | float) -> np.ndarray | float:
    """Latent heat of vaporisation, J/kg."""
    return 2.501e6 - 2360.0 * t_c


# --------------------------------------------------------------------------
# parameters
# --------------------------------------------------------------------------
@dataclass
class Meat:
    k: float = 0.45  # W/m/K, thermal conductivity of lean beef
    rho: float = 1050.0  # kg/m^3
    cp: float = 3500.0  # J/kg/K
    emissivity: float = 0.9

    @property
    def alpha(self) -> float:
        return self.k / (self.rho * self.cp)


@dataclass
class Oven:
    t_air: float = 125.0  # C, setpoint
    t_wall: float | None = None  # C, radiant surround (defaults to t_air)
    h_conv: float = 11.0  # W/m^2/K -- ~11 still air, ~25 fan-assisted
    humidity_ratio_air: float = 0.008  # kg/kg, a dry-ish domestic oven
    cycle_amplitude: float = 0.0  # C, thermostat swing (peak)
    cycle_period: float = 600.0  # s

    def air_temp(self, t: float) -> float:
        if self.cycle_amplitude == 0.0:
            return self.t_air
        return self.t_air + self.cycle_amplitude * np.sin(2 * np.pi * t / self.cycle_period)


@dataclass
class Geometry:
    thickness: float = 0.040  # m
    width: float = 0.120  # m
    length: float = 0.200  # m (assumed long: not resolved, but used for mass)

    def mass(self, meat: Meat) -> float:
        return meat.rho * self.thickness * self.width * self.length


@dataclass
class Surface:
    """Free water on the outside, and the crust that forms once it has gone."""

    free_water: float = 0.10  # kg/m^2 of surface (0.10 == a ~0.1 mm damp film)
    # Vapour resistance of the dried crust, s/m, once `crust_scale` kg/m^2 of
    # the meat's own water has been driven off.  Larger => stronger drying stall
    # relief (the surface heats up sooner).
    crust_resistance: float = 900.0
    crust_scale: float = 0.5


@dataclass
class DoorOpening:
    t_open: float  # s
    duration: float = 25.0  # s out of the oven
    ambient: float = 20.0  # C


@dataclass
class SimResult:
    t: np.ndarray  # s
    core: np.ndarray  # C, geometric centre
    surface: np.ndarray  # C, area-averaged outer face
    water: np.ndarray  # kg/m^2 remaining free water, area-averaged
    mass_loss: np.ndarray  # kg/m^2 cumulative evaporation
    oven: np.ndarray  # C, air temperature actually seen


def simulate(
    duration: float = 7200.0,
    dt: float = 2.0,
    t_initial: float = 5.0,
    geometry: Geometry = None,
    meat: Meat = None,
    oven: Oven = None,
    surface: Surface = None,
    openings: list[DoorOpening] = None,
    nx: int = 24,
    ny: int = 12,
) -> SimResult:
    """Run the cook.  Explicit finite-volume, quarter cross-section."""
    geometry = geometry or Geometry()
    meat = meat or Meat()
    oven = oven or Oven()
    surface = surface or Surface()
    openings = openings or []

    # Quarter domain: x across half the width, y across half the thickness.
    lx = geometry.width / 2.0
    ly = geometry.thickness / 2.0
    dx = lx / nx
    dy = ly / ny

    stable = 0.5 / (meat.alpha * (1 / dx**2 + 1 / dy**2))
    if dt > 0.9 * stable:
        dt = 0.9 * stable

    T = np.full((ny, nx), float(t_initial))  # row 0 = mid-plane, row -1 = surface
    # Free water sits on the two exposed faces of the quarter domain:
    # the top face (y = ly) over all x, and the right face (x = lx) over all y.
    water_top = np.full(nx, surface.free_water)
    water_side = np.full(ny, surface.free_water)
    dried_top = np.zeros(nx)
    dried_side = np.zeros(ny)

    rho_cp = meat.rho * meat.cp
    t_wall = oven.t_wall if oven.t_wall is not None else oven.t_air

    n_steps = int(duration / dt)
    rec_every = max(1, int(round(10.0 / dt)))  # record ~every 10 s

    ts, cores, surfs, waters, losses, ovens = [], [], [], [], [], []

    def surface_flux(t_s, water, dried, t_air, t_rad, h_conv, in_oven):
        """Net heat flux into the meat at a boundary face, W/m^2, and the
        evaporation rate, kg/m^2/s."""
        sensible = h_conv * (t_air - t_s)
        radiant = meat.emissivity * SIGMA * ((t_rad + 273.15) ** 4 - (t_s + 273.15) ** 4)

        if in_oven:
            # Lewis analogy, convective part only.  rho_air at the film temp.
            t_film = 0.5 * (t_air + t_s)
            rho_air = P_ATM / (287.05 * (t_film + 273.15))
            h_mass = h_conv / (rho_air * 1006.0 * 0.9)  # m/s
            w_air = oven.humidity_ratio_air
        else:
            rho_air = 1.2
            h_mass = h_conv / (rho_air * 1006.0 * 0.9)
            w_air = 0.008

        dw = humidity_ratio(t_s) - w_air
        dw = np.maximum(dw, 0.0)
        # Series resistance: boundary layer, plus crust once free water is gone.
        r_film = 1.0 / (h_mass * rho_air)
        r_crust = np.where(water > 0.0, 0.0, surface.crust_resistance * dried / surface.crust_scale)
        m_dot = dw / (r_film + r_crust)
        evap = m_dot * latent_heat(t_s)
        return sensible + radiant - evap, m_dot

    for step in range(n_steps):
        t = step * dt

        in_oven = True
        t_air = oven.air_temp(t)
        t_rad = t_wall
        h_conv = oven.h_conv
        for op in openings:
            if op.t_open <= t < op.t_open + op.duration:
                in_oven = False
                t_air = op.ambient
                t_rad = op.ambient
                h_conv = 9.0
                break

        # --- conduction (interior fluxes) ---
        lap = np.zeros_like(T)
        # x-direction; x=0 is a symmetry plane (zero flux)
        fx = meat.k * (T[:, :-1] - T[:, 1:]) / dx  # flux from left cell to right
        lap[:, :-1] -= fx / dx
        lap[:, 1:] += fx / dx
        # y-direction; y=0 is a symmetry plane
        fy = meat.k * (T[:-1, :] - T[1:, :]) / dy
        lap[:-1, :] -= fy / dy
        lap[1:, :] += fy / dy

        # --- boundary faces ---
        q_top, m_top = surface_flux(T[-1, :], water_top, dried_top, t_air, t_rad, h_conv, in_oven)
        q_side, m_side = surface_flux(T[:, -1], water_side, dried_side, t_air, t_rad, h_conv, in_oven)
        lap[-1, :] += q_top / dy
        lap[:, -1] += q_side / dx

        T = T + dt * lap / rho_cp

        # --- surface water bookkeeping ---
        evap_top = m_top * dt
        take = np.minimum(water_top, evap_top)
        water_top -= take
        dried_top += evap_top - take
        evap_side = m_side * dt
        take = np.minimum(water_side, evap_side)
        water_side -= take
        dried_side += evap_side - take

        if step % rec_every == 0:
            ts.append(t)
            cores.append(T[0, 0])
            # area-weighted mean of the two exposed faces
            a_top, a_side = nx * dx, ny * dy
            surfs.append((T[-1, :].mean() * a_top + T[:, -1].mean() * a_side) / (a_top + a_side))
            waters.append((water_top.mean() * a_top + water_side.mean() * a_side) / (a_top + a_side))
            losses.append((dried_top.mean() * a_top + dried_side.mean() * a_side) / (a_top + a_side))
            ovens.append(t_air)

    return SimResult(
        t=np.array(ts),
        core=np.array(cores),
        surface=np.array(surfs),
        water=np.array(waters),
        mass_loss=np.array(losses),
        oven=np.array(ovens),
    )


def wet_bulb(t_air: float, w_air: float = 0.008) -> float:
    """Adiabatic-saturation temperature of the oven air, C.

    This is the floor the whole steak is pinned under while its surface is
    genuinely wet -- the single most important number in this problem when the
    target is only 44 C.
    """
    lo, hi = 0.0, t_air
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        lhs = latent_heat(mid) * (humidity_ratio(mid) - w_air)
        rhs = (1006.0 + 1860.0 * w_air) * (t_air - mid)
        if lhs > rhs:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


if __name__ == "__main__":
    ov = Oven()
    print(f"oven air {ov.t_air:.0f} C, w={ov.humidity_ratio_air}")
    print(f"  wet-bulb (fully wet surface, no radiation) = {wet_bulb(ov.t_air, ov.humidity_ratio_air):.1f} C")
    r = simulate(duration=6000.0)
    for target in (30.0, 40.0, 44.0, 50.0):
        idx = np.searchsorted(r.core, target)
        if idx < len(r.t):
            print(f"  core {target:.0f} C at {r.t[idx] / 60:5.1f} min")
    for minutes in (5, 10, 20, 30, 45, 60, 90):
        i = np.searchsorted(r.t, minutes * 60)
        if i < len(r.t):
            print(
                f"  t={minutes:3d} min  core={r.core[i]:5.1f}  surface={r.surface[i]:5.1f}"
                f"  free water={r.water[i] * 1000:5.2f} g/m2"
            )
