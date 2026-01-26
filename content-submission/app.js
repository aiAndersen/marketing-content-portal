// Initialize Supabase Client
const supabaseClient = window.supabase.createClient(
  SUPABASE_CONFIG.url,
  SUPABASE_CONFIG.anonKey
);

// Form Elements
const form = document.getElementById('content-form');
const successMessage = document.getElementById('success-message');
const submitText = document.getElementById('submit-text');
const submitLoading = document.getElementById('submit-loading');

// Handle Form Submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Disable submit button
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitText.classList.add('hidden');
  submitLoading.classList.remove('hidden');

  try {
    // Get form data
    const formData = new FormData(form);
    const data = {
      type: formData.get('type'),
      title: formData.get('title'),
      live_link: formData.get('live_link'),
      ungated_link: formData.get('ungated_link') || null,
      platform: formData.get('platform'),
      state: formData.get('state') || null,
      summary: formData.get('summary'),
      tags: formData.get('tags') || null,
      last_updated: new Date().toISOString(),
    };

    // Insert into Supabase
    const { error } = await supabaseClient
      .from('marketing_content')
      .insert([data]);

    if (error) throw error;

    // Show success message
    form.classList.add('hidden');
    successMessage.classList.remove('hidden');

  } catch (error) {
    console.error('Error submitting content:', error);
    alert('Error submitting content. Please try again or contact IT support.');

    // Re-enable button
    submitBtn.disabled = false;
    submitText.classList.remove('hidden');
    submitLoading.classList.add('hidden');
  }
});

// Reset form to submit another
function resetForm() {
  form.reset();
  form.classList.remove('hidden');
  successMessage.classList.add('hidden');

  // Re-enable submit button
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = false;
  submitText.classList.remove('hidden');
  submitLoading.classList.add('hidden');
}
