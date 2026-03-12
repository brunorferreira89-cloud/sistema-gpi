-- Allow admin and consultor to delete profiles (for removing portal access)
CREATE POLICY "Admin and consultor can delete profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (get_user_role(auth.uid()) IN ('admin', 'consultor'));