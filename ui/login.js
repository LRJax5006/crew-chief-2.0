// ui/login.js
// Login modal/component for user authentication
// Expects: onLogin, onLogout, user state

// Replace YOUR_GOOGLE_CLIENT_ID with your actual client ID from Google Cloud Console
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';

export function showLoginModal({ onLogin, onLogout, user }) {
    const modal = document.createElement('div');
    modal.className = 'login-modal';
    modal.innerHTML = `
        <div class="login-modal-content" tabindex="-1" role="dialog" aria-modal="true" aria-label="Sign In Modal">
            <button class="login-modal-close" aria-label="Close modal">&times;</button>
            <div class="login-modal-signin-label">Sign In</div>
            <div class="login-modal-google-btn">
                <div class="archaeolab-logo-bg">
                  <img src="Archaeolab_logo.svg" alt="Archaeolab Logo" />
                </div>
                <div id="googleSignInDiv"></div>
            </div>
            <button id="loginIcloudBtn" style="display:none;">Sign in with iCloud</button>
            <button id="logoutBtn" style="display:none;">Sign Out</button>
        </div>
    `;
    // Adjust label position to avoid overlap
    const signinLabel = modal.querySelector('.login-modal-signin-label');
    signinLabel.style.marginTop = '2.5em';
    signinLabel.style.marginBottom = '1.1em';
    document.body.appendChild(modal);

    // Focus modal for accessibility
    const modalContent = modal.querySelector('.login-modal-content');
    if (modalContent) modalContent.focus();

    // Move close button to top right and add click handler
    const closeBtn = modal.querySelector('.login-modal-close');
    closeBtn.onclick = () => modal.remove();
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '0.2em';
    closeBtn.style.right = '0.2em';
    closeBtn.style.fontSize = '2.2em';
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.color = '#fcfbfb';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.zIndex = '2';

    // Close modal on click outside content
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };

    // Close modal on Esc key
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
        }
    };
    document.addEventListener('keydown', escHandler);
    // Remove Esc handler when modal closes
    modal.addEventListener('remove', () => {
        document.removeEventListener('keydown', escHandler);
    });

    // Render Google Sign-In button
    if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.initialize({
            client_id: "510249519753-9ie5660oq1pmoj3hek4tgmkl0e4hjoi5.apps.googleusercontent.com",
            callback: (response) => {
                onLogin({ provider: 'google', credential: response.credential });
                if (modal) modal.remove();
            },
        });
        window.google.accounts.id.renderButton(
            modal.querySelector('#googleSignInDiv'),
            { theme: 'outline', size: 'medium', width: 220 }
        );
    } else {
        modal.querySelector('#googleSignInDiv').innerHTML = '<p style="color:red">Google Sign-In failed to load.</p>';
    }

    const loginIcloudBtn = modal.querySelector('#loginIcloudBtn');
    const logoutBtn = modal.querySelector('#logoutBtn');

    // Hide iCloud button until activated
    loginIcloudBtn.style.display = 'none';
    loginIcloudBtn.onclick = () => onLogin('icloud');
    logoutBtn.onclick = () => onLogout();

    if (user) {
        modal.querySelector('#googleSignInDiv').style.display = 'none';
        // loginIcloudBtn.style.display = 'none';
        logoutBtn.style.display = '';
    }

    return modal;
}
