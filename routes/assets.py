from flask import Blueprint, render_template

assets_bp = Blueprint("assets", __name__)

# =========================
# ASSET REGISTER (LIST)
# =========================
@assets_bp.route("/assets")
def asset_register():
    """
    Displays the master asset register list
    """
    return render_template("assets.html")


# =========================
# ASSET PROFILE (DETAIL)
# =========================
@assets_bp.route("/assets/<asset_id>")
def asset_profile(asset_id):
    """
    Displays a single asset profile page
    asset_id comes from the table 'View' button
    """
    return render_template(
        "asset_detail.html",
        asset_id=asset_id
    )


# =========================
# BREAKDOWNS DASHBOARD
# =========================
@assets_bp.route("/breakdowns")
def breakdowns_dashboard():
    """
    Displays breakdowns overview (future expansion)
    """
    return render_template("breakdowns.html")
