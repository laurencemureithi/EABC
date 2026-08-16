from flask import Blueprint, render_template

assets_bp = Blueprint('assets', __name__)

@assets_bp.route("/breakdowns")
def breakdowns_dashboard():
    return render_template("breakdowns.html")
